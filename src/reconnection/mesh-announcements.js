/**
 * Mesh Announcement Manager
 *
 * Handles presence announcements and IP change notifications using gossip protocol
 * via flood routing. Enables automatic peer reconnection after page refresh or
 * network changes.
 *
 * Features:
 * - Presence announcements with cryptographic signatures
 * - IP change announcements with proof of identity
 * - Deterministic tie-breaking to prevent duplicate connections
 * - Announcement deduplication via signature tracking
 * - Periodic heartbeat announcements
 * - Automatic reconnection decision logic
 * - Integration with flood routing and ReconnectionAuth
 *
 * @module reconnection/mesh-announcements
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

export const ANNOUNCEMENT_CONFIG = {
  // Timing
  PERIODIC_INTERVAL: 120000,              // 2 minutes between periodic announcements
  RECONNECTION_COOLDOWN: 60000,           // 1 minute cooldown between reconnection attempts
  RECONNECTION_DELAY_MIN: 1000,           // Minimum delay before initiating reconnection
  RECONNECTION_DELAY_MAX: 3000,           // Maximum delay (adds random jitter)

  // Deduplication
  ANNOUNCEMENT_CACHE_SIZE: 1000,          // Max announcements to cache
  ANNOUNCEMENT_CACHE_TTL: 300000,         // 5 minutes
  CLEANUP_INTERVAL: 60000,                // 1 minute

  // TTL values
  DEFAULT_ANNOUNCEMENT_TTL: 7,            // Standard announcement TTL
  IP_CHANGE_ANNOUNCEMENT_TTL: 10,         // Higher TTL for important announcements

  // Connection limits
  MIN_PEERS_FOR_PERIODIC: 1,              // Only send periodic if we have connections

  // Announcement reasons
  REASONS: {
    REJOIN: 'rejoin',
    IP_CHANGE: 'ip_change',
    PERIODIC: 'periodic',
    COLD_START_RECOVERY: 'cold_start_recovery',
  }
};

// =============================================================================
// MESH ANNOUNCEMENT MANAGER
// =============================================================================

class MeshAnnouncementManager {
  /**
   * Create announcement manager
   * @param {Object} identity - Identity manager instance
   * @param {Object} router - MessageRouter instance
   * @param {Object} peerManager - MeshNetwork instance (has peers Map)
   * @param {Object} reconnectionAuth - ReconnectionAuth instance
   * @param {Object} peerPersistence - PeerPersistenceManager instance
   */
  constructor(identity, router, peerManager, reconnectionAuth, peerPersistence) {
    this.identity = identity;
    this.router = router;
    this.peerManager = peerManager;
    this.reconnectionAuth = reconnectionAuth;
    this.peerPersistence = peerPersistence;

    // Announcement tracking
    this.recentAnnouncements = new Map(); // peerId -> { timestamp, signature, nonce }
    this.reconnectAttempts = new Map();   // peerId -> timestamp of last attempt

    // Periodic announcement timer
    this.announcementInterval = null;

    // Statistics
    this.stats = {
      announcementsSent: 0,
      announcementsReceived: 0,
      duplicatesIgnored: 0,
      reconnectionsInitiated: 0,
      reconnectionsFailed: 0,
    };

    // Start cleanup timer
    this.startCleanup();
  }

  /**
   * Initialize the manager and register message handlers
   */
  initialize() {
    // Register message handlers with router
    this.router.on('peer_announcement', (msg) => this.handlePeerAnnouncement(msg));
    this.router.on('ip_change_announcement', (msg) => this.handleIpChange(msg));
  }

  // ===========================================================================
  // PRESENCE ANNOUNCEMENTS
  // ===========================================================================

  /**
   * Announce our presence to the mesh network
   *
   * Broadcasts a cryptographically signed announcement to inform peers that
   * we are online and available for reconnection.
   *
   * @param {string} reason - Announcement reason: 'rejoin', 'ip_change', 'periodic', 'cold_start_recovery'
   * @returns {Promise<boolean>} Success status
   */
  async announcePresence(reason = ANNOUNCEMENT_CONFIG.REASONS.REJOIN) {
    try {
      // Get list of currently connected peers for connection hints
      const connectedPeers = Array.from(this.peerManager.peers.keys())
        .filter(peerId => {
          const peer = this.peerManager.peers.get(peerId);
          return peer && peer.status === 'connected';
        });

      // Determine best relay peer
      const preferredRelay = this.getBestRelayPeer();

      // Create signed announcement using ReconnectionAuth
      const announcement = await this.reconnectionAuth.createAnnouncement({
        reason,
        peerId: this.identity.peerId || this.identity.uuid,
        displayName: this.identity.displayName,
        timestamp: Date.now(),
        connectedPeers,
      });

      // Add connection hints
      const payload = {
        ...announcement,
        connectionHint: {
          preferredRelay,
          connectedPeers: connectedPeers.slice(0, 5), // Limit to top 5
        }
      };

      // Determine TTL based on importance
      const ttl = reason === ANNOUNCEMENT_CONFIG.REASONS.IP_CHANGE
        ? ANNOUNCEMENT_CONFIG.IP_CHANGE_ANNOUNCEMENT_TTL
        : ANNOUNCEMENT_CONFIG.DEFAULT_ANNOUNCEMENT_TTL;

      // Create message envelope for flood routing
      const message = this.router.createMessage('peer_announcement', payload, {
        ttl,
        routingHint: 'broadcast',
      });

      // Broadcast via flood routing
      await this.router.routeMessage(message);

      this.stats.announcementsSent++;

      return true;

    } catch (error) {
      console.error('[AnnouncementManager] Failed to announce presence:', error);
      return false;
    }
  }

  /**
   * Handle peer announcement received via gossip
   *
   * Verifies the cryptographic signature, checks for duplicates, and
   * decides whether to initiate reconnection using deterministic tie-breaking.
   *
   * @param {Object} message - Announcement message from router
   */
  async handlePeerAnnouncement(message) {
    try {
      this.stats.announcementsReceived++;

      const payload = message.payload;
      const peerId = payload.peerId;
      const displayName = payload.displayName || 'Unknown';

      // Don't process our own announcements
      if (peerId === this.identity.peerId || peerId === this.identity.uuid) {
        return;
      }

      // Check for duplicate announcements
      if (this.isDuplicateAnnouncement(peerId, payload)) {
        this.stats.duplicatesIgnored++;
        return;
      }

      // Record this announcement
      this.recordAnnouncement(peerId, payload);

      // Verify cryptographic signature
      const verification = await this.reconnectionAuth.verifyAnnouncement(payload);

      if (!verification.valid) {
        // Log security alerts
        if (verification.reason === 'invalid_signature') {
          console.error('[AnnouncementManager] SECURITY: Invalid signature detected - possible impersonation attempt');
        }

        return;
      }

      // Check if we should reconnect to this peer
      const knownPeer = await this.peerPersistence.getPeer(peerId);

      if (!this.shouldReconnectToPeer(peerId, knownPeer)) {
        return;
      }

      // Deterministic tie-breaking: only one peer initiates
      if (!this.shouldInitiate(peerId)) {
        return;
      }

      // Add random jitter to prevent thundering herd
      const delay = ANNOUNCEMENT_CONFIG.RECONNECTION_DELAY_MIN +
        Math.random() * (ANNOUNCEMENT_CONFIG.RECONNECTION_DELAY_MAX - ANNOUNCEMENT_CONFIG.RECONNECTION_DELAY_MIN);

      setTimeout(() => {
        this.initiateReconnection(peerId, displayName, payload.connectionHint);
      }, delay);

    } catch (error) {
      console.error('[AnnouncementManager] Error handling peer announcement:', error);
    }
  }

  // ===========================================================================
  // IP CHANGE ANNOUNCEMENTS
  // ===========================================================================

  /**
   * Announce IP address change with cryptographic proof
   *
   * Used when a peer's IP address changes (e.g., network switch, VPN toggle).
   * Includes cryptographic proof to prevent impersonation.
   *
   * @returns {Promise<boolean>} Success status
   */
  async announceIpChange() {
    try {
      // Create challenge for IP change proof
      const challenge = `ip-change-${Date.now()}`;

      // Get connection hints
      const connectedPeers = Array.from(this.peerManager.peers.keys())
        .filter(peerId => {
          const peer = this.peerManager.peers.get(peerId);
          return peer && peer.status === 'connected';
        });

      const preferredRelay = this.getBestRelayPeer();

      // Create signed announcement
      const announcement = await this.reconnectionAuth.createAnnouncement({
        reason: ANNOUNCEMENT_CONFIG.REASONS.IP_CHANGE,
        peerId: this.identity.peerId || this.identity.uuid,
        displayName: this.identity.displayName,
        timestamp: Date.now(),
        challenge,
        connectedPeers,
      });

      // Add connection info
      const payload = {
        ...announcement,
        connectionHint: {
          preferredRelay,
          connectedPeers: connectedPeers.slice(0, 5),
        }
      };

      // Create message with higher TTL (important announcement)
      const message = this.router.createMessage('ip_change_announcement', payload, {
        ttl: ANNOUNCEMENT_CONFIG.IP_CHANGE_ANNOUNCEMENT_TTL,
        routingHint: 'broadcast',
      });

      // Broadcast
      await this.router.routeMessage(message);

      this.stats.announcementsSent++;

      return true;

    } catch (error) {
      console.error('[AnnouncementManager] Failed to announce IP change:', error);
      return false;
    }
  }

  /**
   * Handle IP change announcement
   *
   * @param {Object} message - IP change announcement
   */
  async handleIpChange(message) {
    try {
      const payload = message.payload;
      const peerId = payload.peerId;
      const displayName = payload.displayName || 'Unknown';

      // Don't process our own announcements
      if (peerId === this.identity.peerId || peerId === this.identity.uuid) {
        return;
      }

      // Check for duplicates
      if (this.isDuplicateAnnouncement(peerId, payload)) {
        this.stats.duplicatesIgnored++;
        return;
      }

      // Record announcement
      this.recordAnnouncement(peerId, payload);

      // Verify signature
      const verification = await this.reconnectionAuth.verifyAnnouncement(payload);

      if (!verification.valid) {
        return;
      }

      // If we're currently connected to this peer, we might need to update connection
      const existingPeer = this.peerManager.peers.get(peerId);
      if (existingPeer && existingPeer.status === 'connected') {
        return;
      }

      // Check if we should reconnect
      const knownPeer = await this.peerPersistence.getPeer(peerId);

      if (!this.shouldReconnectToPeer(peerId, knownPeer)) {
        return;
      }

      // Deterministic tie-breaking
      if (!this.shouldInitiate(peerId)) {
        return;
      }

      // Higher priority reconnection for IP changes
      const delay = ANNOUNCEMENT_CONFIG.RECONNECTION_DELAY_MIN / 2 +
        Math.random() * ANNOUNCEMENT_CONFIG.RECONNECTION_DELAY_MIN;

      setTimeout(() => {
        this.initiateReconnection(peerId, displayName, payload.connectionHint);
      }, delay);

    } catch (error) {
      console.error('[AnnouncementManager] Error handling IP change:', error);
    }
  }

  // ===========================================================================
  // PERIODIC HEARTBEAT
  // ===========================================================================

  /**
   * Start periodic announcements (heartbeat)
   *
   * Sends periodic presence announcements to maintain discoverability.
   * Only announces if we have active connections.
   *
   * @param {number} interval - Milliseconds between announcements (default 120000 = 2 minutes)
   */
  startPeriodicAnnouncements(interval = ANNOUNCEMENT_CONFIG.PERIODIC_INTERVAL) {
    // Clear existing interval if any
    this.stopPeriodicAnnouncements();

    this.announcementInterval = setInterval(async () => {
      // Only announce if we have connections
      const connectedCount = this.peerManager.getConnectedPeerCount();

      if (connectedCount >= ANNOUNCEMENT_CONFIG.MIN_PEERS_FOR_PERIODIC) {
        await this.announcePresence(ANNOUNCEMENT_CONFIG.REASONS.PERIODIC);
      }
    }, interval);
  }

  /**
   * Stop periodic announcements
   */
  stopPeriodicAnnouncements() {
    if (this.announcementInterval) {
      clearInterval(this.announcementInterval);
      this.announcementInterval = null;
    }
  }

  // ===========================================================================
  // RECONNECTION LOGIC
  // ===========================================================================

  /**
   * Check if we should attempt reconnection to announced peer
   *
   * Evaluates multiple criteria:
   * - Peer approval status
   * - Current connection status
   * - Connection limits
   * - Recent failed attempts
   *
   * @param {string} peerId - Peer ID
   * @param {Object} knownPeer - Peer data from peerPersistence (may be null)
   * @returns {boolean} True if we should reconnect
   */
  shouldReconnectToPeer(peerId, knownPeer) {
    // Check if already connected
    const existingPeer = this.peerManager.peers.get(peerId);
    if (existingPeer && (existingPeer.status === 'connected' || existingPeer.status === 'connecting')) {
      return false;
    }

    // Check connection limits
    const currentCount = this.peerManager.getConnectedPeerCount();
    const maxConnections = this.peerManager.maxConnections || 6; // Default from mesh.js

    if (currentCount >= maxConnections) {
      return false;
    }

    // Check if recently tried and failed
    const lastAttempt = this.reconnectAttempts.get(peerId);
    if (lastAttempt) {
      const timeSinceAttempt = Date.now() - lastAttempt;
      if (timeSinceAttempt < ANNOUNCEMENT_CONFIG.RECONNECTION_COOLDOWN) {
        return false;
      }
    }

    // Check if peer is blacklisted in persistence
    if (knownPeer && knownPeer.blacklistUntil && knownPeer.blacklistUntil > Date.now()) {
      return false;
    }

    return true;
  }

  /**
   * Deterministic tie-breaking for connection initiation
   *
   * Uses lexicographic comparison of peer IDs to ensure only one peer
   * initiates the connection, preventing duplicate connections.
   *
   * Pattern: Lower peer ID always initiates
   *
   * @param {string} announcedPeerId - Peer ID that announced
   * @returns {boolean} True if we should initiate
   */
  shouldInitiate(announcedPeerId) {
    const ourPeerId = this.identity.peerId || this.identity.uuid;

    // Lexicographic comparison - lower ID initiates
    const shouldInitiate = ourPeerId < announcedPeerId;

    return shouldInitiate;
  }

  /**
   * Initiate reconnection to announced peer
   *
   * Attempts to establish a WebRTC connection using the peer manager.
   * Records the attempt for cooldown tracking.
   *
   * @param {string} peerId - Peer ID to reconnect to
   * @param {string} displayName - Peer display name
   * @param {Object} connectionHint - Optional connection hints (preferredRelay, etc.)
   */
  async initiateReconnection(peerId, displayName, connectionHint = null) {
    try {
      // Record attempt
      this.reconnectAttempts.set(peerId, Date.now());
      this.stats.reconnectionsInitiated++;

      // Update last seen in persistence
      await this.peerPersistence.updateLastSeen(peerId);

      // Check if peer manager has a reconnection method
      if (typeof this.peerManager.reconnectToPeer === 'function') {
        // Use dedicated reconnection method if available
        await this.peerManager.reconnectToPeer(peerId, displayName, connectionHint);
      } else {
        // Fallback: Let the application handle reconnection via events
        // Could emit an event here if the peer manager supports it
        if (this.peerManager.onReconnectionNeeded) {
          this.peerManager.onReconnectionNeeded(peerId, displayName, connectionHint);
        }
      }

    } catch (error) {
      console.error(`[AnnouncementManager] Failed to reconnect to ${displayName}:`, error);
      this.stats.reconnectionsFailed++;

      // Increment failure count in persistence
      await this.peerPersistence.incrementReconnectionAttempts(peerId);
    }
  }

  /**
   * Get best relay peer for connection hints
   *
   * Selects the peer with the best connection quality to use as a relay.
   *
   * @returns {string|null} Peer ID with best connection, or null if no suitable peer
   */
  getBestRelayPeer() {
    let bestPeer = null;
    let bestScore = -1;

    for (const [peerId, peerData] of this.peerManager.peers.entries()) {
      if (peerData.status !== 'connected') continue;

      // Calculate simple quality score
      let score = 100;

      // Penalize high latency
      if (peerData.latency) {
        score -= Math.min(50, peerData.latency / 10);
      }

      // Prefer direct connections
      if (peerData.connectionType === 'host') {
        score += 20;
      } else if (peerData.connectionType === 'srflx') {
        score += 10;
      }

      // Prefer long-lived connections
      if (peerData.connectedAt) {
        const uptime = Date.now() - peerData.connectedAt;
        score += Math.min(20, uptime / 60000); // +1 per minute, max 20
      }

      if (score > bestScore) {
        bestScore = score;
        bestPeer = peerId;
      }
    }

    return bestPeer;
  }

  /**
   * Check if peer was recently connected
   *
   * Useful for prioritizing reconnection to recently active peers.
   *
   * @param {string} peerId - Peer ID
   * @returns {boolean} True if recently connected
   */
  wasRecentlyConnected(peerId) {
    const peerData = this.peerManager.peers.get(peerId);

    if (!peerData || !peerData.disconnectedAt) {
      return false;
    }

    const timeSinceDisconnect = Date.now() - peerData.disconnectedAt;

    // Consider "recent" as within last 5 minutes
    return timeSinceDisconnect < 300000;
  }

  // ===========================================================================
  // DEDUPLICATION
  // ===========================================================================

  /**
   * Check if announcement is a duplicate
   *
   * @param {string} peerId - Peer ID
   * @param {Object} payload - Announcement payload
   * @returns {boolean} True if duplicate
   */
  isDuplicateAnnouncement(peerId, payload) {
    const cached = this.recentAnnouncements.get(peerId);

    if (!cached) {
      return false;
    }

    // Check signature match (most reliable duplicate detection)
    if (cached.signature === payload.signature) {
      return true;
    }

    // Check nonce match (in case signature is missing)
    if (cached.nonce === payload.nonce) {
      return true;
    }

    // Check if very recent (same timestamp within 1 second)
    if (Math.abs(cached.timestamp - payload.timestamp) < 1000) {
      return true;
    }

    return false;
  }

  /**
   * Record announcement for deduplication
   *
   * @param {string} peerId - Peer ID
   * @param {Object} payload - Announcement payload
   */
  recordAnnouncement(peerId, payload) {
    this.recentAnnouncements.set(peerId, {
      timestamp: payload.timestamp,
      signature: payload.signature,
      nonce: payload.nonce,
      recordedAt: Date.now(),
    });

    // Prevent unbounded growth
    if (this.recentAnnouncements.size > ANNOUNCEMENT_CONFIG.ANNOUNCEMENT_CACHE_SIZE) {
      this.pruneOldestAnnouncements(100);
    }
  }

  /**
   * Prune oldest announcements from cache
   *
   * @param {number} count - Number of entries to remove
   */
  pruneOldestAnnouncements(count) {
    const sorted = Array.from(this.recentAnnouncements.entries())
      .sort((a, b) => a[1].recordedAt - b[1].recordedAt);

    for (let i = 0; i < count && i < sorted.length; i++) {
      this.recentAnnouncements.delete(sorted[i][0]);
    }
  }

  /**
   * Clean up old announcements (periodic maintenance)
   */
  cleanupOldAnnouncements() {
    const now = Date.now();
    let cleaned = 0;

    for (const [peerId, data] of this.recentAnnouncements.entries()) {
      if (now - data.recordedAt > ANNOUNCEMENT_CONFIG.ANNOUNCEMENT_CACHE_TTL) {
        this.recentAnnouncements.delete(peerId);
        cleaned++;
      }
    }
  }

  /**
   * Start cleanup timer
   */
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldAnnouncements();
    }, ANNOUNCEMENT_CONFIG.CLEANUP_INTERVAL);
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Get statistics
   *
   * @returns {Object} Manager statistics
   */
  getStats() {
    return {
      ...this.stats,
      cachedAnnouncements: this.recentAnnouncements.size,
      reconnectCooldowns: this.reconnectAttempts.size,
      periodicActive: !!this.announcementInterval,
    };
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stopPeriodicAnnouncements();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.recentAnnouncements.clear();
    this.reconnectAttempts.clear();
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default MeshAnnouncementManager;
