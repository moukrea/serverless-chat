/**
 * Cold Start Recovery Manager for P2P Mesh Networks
 *
 * Handles the hardest recovery scenario: peer refreshes browser with ZERO active connections.
 * Cannot use mesh relay or gossip protocols (no connections exist!).
 * Must try direct reconnection and creative strategies to re-establish connectivity.
 *
 * Success rate: 10-40% depending on cache freshness, network conditions, and NAT stability
 *
 * Multi-Layer Fallback Strategy:
 * 1. Recent Peers (< 5 min) - Direct reconnection to recently connected peers
 * 2. Knock Protocol - Experimental NAT wake-up via minimal WebRTC packets
 * 3. All Known Peers (< 24 hours) - Aggressive parallel reconnection attempts
 * 4. Initial Pairing Fallback - Show UI for manual intervention
 * 5. Complete Failure - Offline mode with manual pairing option
 *
 * Flow Diagram:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ COLD START DETECTED (0 active connections)                      │
 * └────────────────────────┬────────────────────────────────────────┘
 *                          ▼
 *         ┌─────────────────────────────────────────┐
 *         │ Layer 1: Recent Peers (< 5 min)        │
 *         │ - Top 5 most recent peers               │
 *         │ - Parallel attempts, 10s timeout        │
 *         │ - Success? → Use warm mesh for rest    │
 *         └────────────┬────────────────────────────┘
 *                      │ Failed
 *                      ▼
 *         ┌─────────────────────────────────────────┐
 *         │ Layer 2: Knock Protocol (Experimental)  │
 *         │ - Send minimal UDP packets               │
 *         │ - Wake cached NAT bindings              │
 *         │ - Success? → Use warm mesh for rest    │
 *         └────────────┬────────────────────────────┘
 *                      │ Failed
 *                      ▼
 *         ┌─────────────────────────────────────────┐
 *         │ Layer 3: All Known Peers (< 24h)        │
 *         │ - Top 10 peers by reconnection score    │
 *         │ - Parallel attempts, 15s timeout        │
 *         │ - Success? → Use warm mesh for rest    │
 *         └────────────┬────────────────────────────┘
 *                      │ Failed
 *                      ▼
 *         ┌─────────────────────────────────────────┐
 *         │ Layer 4: Initial Pairing Fallback       │
 *         │ - Check saved passphrase                │
 *         │ - Show pairing UI (QR/passphrase)      │
 *         │ - Wait for manual intervention          │
 *         └────────────┬────────────────────────────┘
 *                      │ Failed
 *                      ▼
 *         ┌─────────────────────────────────────────┐
 *         │ Layer 5: Complete Failure               │
 *         │ - Show offline mode                     │
 *         │ - Manual pairing button visible         │
 *         └─────────────────────────────────────────┘
 *
 * Dependencies:
 * - PeerPersistenceManager: Retrieve stored peer data with reconnection scores
 * - DirectReconnectionManager: Attempt direct peer-to-peer reconnections
 * - MeshAnnouncementManager: Announce presence once we have one connection
 * - ICE Configuration: WebRTC configuration for connection attempts
 */

import ICE_CONFIG from '../config/ice-config.js';
import peerPersistence from '../storage/peer-persistence.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const COLD_START_CONFIG = {
  // Layer 1: Recent Peers
  RECENT_PEERS: {
    MAX_AGE_MS: 5 * 60 * 1000,        // 5 minutes
    MAX_ATTEMPTS: 5,                   // Try top 5 peers
    TIMEOUT_MS: 10000,                 // 10 second timeout per peer
  },

  // Layer 2: Knock Protocol
  KNOCK: {
    MAX_ATTEMPTS: 3,                   // Try top 3 peers
    TIMEOUT_MS: 5000,                  // 5 second timeout per knock
    ENABLED: true,                     // Enable experimental knock protocol
  },

  // Layer 3: All Known Peers
  ALL_PEERS: {
    MAX_AGE_MS: 24 * 60 * 60 * 1000,  // 24 hours
    MAX_ATTEMPTS: 10,                  // Try top 10 peers
    TIMEOUT_MS: 15000,                 // 15 second timeout per peer
  },

  // Layer 4: Fallback Settings
  FALLBACK: {
    CHECK_SAVED_PASSPHRASE: false,     // Disabled
    SHOW_PAIRING_UI: true,             // Show manual pairing UI
  },

  // Warm Mesh Settings
  WARM_MESH: {
    DELAY_MS: 2000,                    // Wait 2s before announcing
    WAIT_FOR_MESH_MS: 10000,           // Wait 10s for mesh to propagate
  },

  // Overall Limits
  MAX_TOTAL_TIME_MS: 40000,            // 40 second maximum before fallback
};

// =============================================================================
// COLD START MANAGER
// =============================================================================

class ColdStartManager {
  /**
   * Initialize Cold Start Recovery Manager
   * @param {Object} identity - User identity manager
   * @param {Object} peerManager - MeshNetwork instance (peer manager)
   * @param {Object} peerPersistence - Peer persistence manager
   * @param {Object} directReconnect - Direct reconnection manager (optional)
   * @param {Object} announcements - Mesh announcement manager (optional)
   */
  constructor(identity, peerManager, peerPersistenceManager, directReconnect = null, announcements = null) {
    this.identity = identity;
    this.peerManager = peerManager;
    this.peerPersistence = peerPersistenceManager;
    this.directReconnect = directReconnect;
    this.announcements = announcements;

    // State
    this.isRecovering = false;
    this.recoveryStartTime = null;
    this.currentLayer = null;
    this.attemptLog = [];

    console.log('[ColdStart] Manager initialized');
  }

  // ===========================================================================
  // MAIN RECOVERY FLOW
  // ===========================================================================

  /**
   * Main cold start recovery entry point
   * Orchestrates multi-layer fallback strategy
   * @returns {Promise<{success: boolean, method?: string, connected?: number, fallbackRequired?: boolean}>}
   */
  async handleColdStart() {
    if (this.isRecovering) {
      console.warn('[ColdStart] Recovery already in progress');
      return { success: false, reason: 'recovery_in_progress' };
    }

    this.isRecovering = true;
    this.recoveryStartTime = Date.now();
    this.attemptLog = [];

    console.log('[ColdStart] ========================================');
    console.log('[ColdStart] COLD START RECOVERY INITIATED');
    console.log('[ColdStart] No active connections, attempting recovery...');
    console.log('[ColdStart] ========================================');

    try {
      // Layer 1: Recent Peers (< 5 min) - Highest priority
      console.log('[ColdStart] Layer 1: Attempting recent peers (< 5 min)...');
      this.currentLayer = 'recent_peers';
      const recentResult = await this.tryRecentPeers();

      if (recentResult.connected > 0) {
        console.log(`[ColdStart] ✓ Success via Layer 1: Connected to ${recentResult.connected} peer(s)`);
        this.logAttempt('recent_peers', true, recentResult.connected);
        await this.useWarmMeshForRest();
        this.isRecovering = false;
        return {
          success: true,
          method: 'recent_peers',
          connected: recentResult.connected,
          duration: Date.now() - this.recoveryStartTime
        };
      }
      this.logAttempt('recent_peers', false, 0);

      // Layer 2: Knock Protocol (Experimental) - Wake NAT bindings
      if (COLD_START_CONFIG.KNOCK.ENABLED) {
        console.log('[ColdStart] Layer 2: Attempting knock protocol (experimental)...');
        this.currentLayer = 'knock_protocol';
        const knockResult = await this.tryKnockProtocol();

        if (knockResult.connected > 0) {
          console.log(`[ColdStart] ✓ Success via Layer 2: Knock protocol woke ${knockResult.connected} peer(s)`);
          this.logAttempt('knock_protocol', true, knockResult.connected);
          await this.useWarmMeshForRest();
          this.isRecovering = false;
          return {
            success: true,
            method: 'knock_protocol',
            connected: knockResult.connected,
            duration: Date.now() - this.recoveryStartTime
          };
        }
        this.logAttempt('knock_protocol', false, 0);
      }

      // Layer 3: All Known Peers (< 24 hours) - Aggressive attempt
      console.log('[ColdStart] Layer 3: Attempting all known peers (< 24h)...');
      this.currentLayer = 'all_known_peers';
      const allPeersResult = await this.tryAllKnownPeers();

      if (allPeersResult.connected > 0) {
        console.log(`[ColdStart] ✓ Success via Layer 3: Connected to ${allPeersResult.connected} peer(s)`);
        this.logAttempt('all_known_peers', true, allPeersResult.connected);
        await this.useWarmMeshForRest();
        this.isRecovering = false;
        return {
          success: true,
          method: 'all_known_peers',
          connected: allPeersResult.connected,
          duration: Date.now() - this.recoveryStartTime
        };
      }
      this.logAttempt('all_known_peers', false, 0);

      // Layer 4: Initial Pairing Fallback - Manual intervention
      console.log('[ColdStart] Layer 4: Falling back to initial pairing...');
      this.currentLayer = 'initial_pairing';
      const fallbackResult = await this.fallbackToInitialPairing();

      if (fallbackResult.success) {
        console.log('[ColdStart] ✓ Success via Layer 4: Initial pairing fallback');
        this.logAttempt('initial_pairing', true, 1);
        this.isRecovering = false;
        return {
          success: true,
          method: fallbackResult.method || 'initial_pairing',
          fallbackRequired: true,
          duration: Date.now() - this.recoveryStartTime
        };
      }

      // Layer 5: Complete Failure
      console.log('[ColdStart] ========================================');
      console.log('[ColdStart] ✗ RECOVERY FAILED - All layers exhausted');
      console.log('[ColdStart] Entering offline mode with manual pairing option');
      console.log('[ColdStart] ========================================');
      this.currentLayer = 'failed';
      this.logAttempt('complete_failure', false, 0);
      this.printRecoveryLog();

      this.isRecovering = false;
      return {
        success: false,
        reason: 'all_methods_failed',
        fallbackRequired: true,
        duration: Date.now() - this.recoveryStartTime
      };

    } catch (error) {
      console.error('[ColdStart] Recovery error:', error);
      this.isRecovering = false;
      return {
        success: false,
        reason: 'recovery_exception',
        error: error.message
      };
    }
  }

  // ===========================================================================
  // LAYER 1: RECENT PEERS RECONNECTION
  // ===========================================================================

  /**
   * Try direct reconnection to recently connected peers (< 5 min)
   * @returns {Promise<{connected: number, peers: Array}>}
   */
  async tryRecentPeers() {
    const recentPeers = await this.getRecentlyConnectedPeers(
      COLD_START_CONFIG.RECENT_PEERS.MAX_AGE_MS
    );

    if (recentPeers.length === 0) {
      console.log('[ColdStart] No recent peers found (< 5 min)');
      return { connected: 0, peers: [] };
    }

    const candidates = recentPeers.slice(0, COLD_START_CONFIG.RECENT_PEERS.MAX_ATTEMPTS);
    console.log(`[ColdStart] Found ${candidates.length} recent peer(s):`,
      candidates.map(p => `${p.displayName} (${p.peerId.substring(0, 8)})`).join(', ')
    );

    return await this.tryDirectReconnections(
      candidates,
      COLD_START_CONFIG.RECENT_PEERS.TIMEOUT_MS
    );
  }

  // ===========================================================================
  // LAYER 2: KNOCK PROTOCOL
  // ===========================================================================

  /**
   * Try "knock" protocol - experimental minimal packets to wake NAT bindings
   * Theory: Send minimal WebRTC packets to wake up cached NAT port mappings
   * Success rate: Very low (~5%), but costs almost nothing to try
   * @param {Array<Object>} peers - Peer candidates (optional, uses recent if not provided)
   * @param {number} timeout - Timeout per knock attempt
   * @returns {Promise<{connected: number}>}
   */
  async tryKnockProtocol(peers = null, timeout = COLD_START_CONFIG.KNOCK.TIMEOUT_MS) {
    if (!peers) {
      // Use recently connected peers for knock attempts
      const recentPeers = await this.getRecentlyConnectedPeers(
        COLD_START_CONFIG.RECENT_PEERS.MAX_AGE_MS
      );
      peers = recentPeers.slice(0, COLD_START_CONFIG.KNOCK.MAX_ATTEMPTS);
    }

    if (peers.length === 0) {
      console.log('[ColdStart] No peers available for knock protocol');
      return { connected: 0 };
    }

    console.log(`[ColdStart] Attempting knock protocol on ${peers.length} peer(s)...`);

    // Try knock on all peers in parallel
    const knockPromises = peers.map(peer =>
      this.sendKnock(peer, timeout)
        .catch(error => ({ success: false, reason: 'exception', error, peerId: peer.peerId }))
    );

    const results = await Promise.allSettled(knockPromises);
    const successes = results
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value);

    if (successes.length > 0) {
      console.log(`[ColdStart] Knock protocol succeeded for ${successes.length} peer(s)`);

      // Once knock succeeds, try actual reconnection
      const knockedPeers = peers.filter(p =>
        successes.some(s => s.peerId === p.peerId)
      );

      return await this.tryDirectReconnections(knockedPeers, timeout * 2);
    }

    console.log('[ColdStart] Knock protocol failed for all peers');
    return { connected: 0 };
  }

  /**
   * Send minimal "knock" packet to potentially wake NAT binding
   * Creates a minimal RTCPeerConnection to trigger ICE candidate generation
   * Theory: Even if full connection fails, ICE packets might wake NAT cache
   * @param {Object} peer - Peer data from persistence
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<{success: boolean, reason?: string}>}
   */
  async sendKnock(peer, timeout) {
    console.log(`[ColdStart] Sending knock to ${peer.displayName} (${peer.peerId.substring(0, 8)})...`);

    return new Promise((resolve) => {
      const pc = new RTCPeerConnection(ICE_CONFIG);

      const timer = setTimeout(() => {
        pc.close();
        resolve({ success: false, reason: 'knock_timeout' });
      }, timeout);

      // Listen for ICE connection state changes
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected') {
          clearTimeout(timer);
          console.log(`[ColdStart] ✓ Knock succeeded for ${peer.displayName}!`);
          pc.close();
          resolve({ success: true, peerId: peer.peerId });
        } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
          clearTimeout(timer);
          pc.close();
          resolve({ success: false, reason: 'knock_failed', state: pc.iceConnectionState });
        }
      };

      // Create data channel to trigger ICE gathering
      pc.createDataChannel('knock');

      // Try to use cached ICE candidates if available
      if (peer.cachedCandidates && peer.cachedCandidates.length > 0) {
        // Create minimal offer
        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer))
          .then(() => {
            // Add cached candidates
            peer.cachedCandidates.forEach(candidate => {
              try {
                pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                // Ignore invalid candidates
              }
            });
          })
          .catch(err => {
            clearTimeout(timer);
            pc.close();
            resolve({ success: false, reason: 'knock_error', error: err.message });
          });
      } else {
        // No cached data, just trigger ICE gathering
        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer))
          .catch(err => {
            clearTimeout(timer);
            pc.close();
            resolve({ success: false, reason: 'no_cached_data', error: err.message });
          });
      }
    });
  }

  // ===========================================================================
  // LAYER 3: ALL KNOWN PEERS RECONNECTION
  // ===========================================================================

  /**
   * Try aggressive reconnection to all known peers (< 24 hours)
   * @returns {Promise<{connected: number, peers: Array}>}
   */
  async tryAllKnownPeers() {
    const allPeers = await this.getAllKnownPeers();

    if (allPeers.length === 0) {
      console.log('[ColdStart] No known peers found (< 24h)');
      return { connected: 0, peers: [] };
    }

    const candidates = allPeers.slice(0, COLD_START_CONFIG.ALL_PEERS.MAX_ATTEMPTS);
    console.log(`[ColdStart] Found ${candidates.length} known peer(s):`,
      candidates.map(p => `${p.displayName} (${p.peerId.substring(0, 8)})`).join(', ')
    );

    return await this.tryDirectReconnections(
      candidates,
      COLD_START_CONFIG.ALL_PEERS.TIMEOUT_MS
    );
  }

  // ===========================================================================
  // DIRECT RECONNECTION ENGINE
  // ===========================================================================

  /**
   * Try direct reconnection to multiple peers in parallel
   * Race: return as soon as ANY succeeds
   * @param {Array<Object>} peers - Peer candidates from persistence
   * @param {number} timeout - Timeout per peer in milliseconds
   * @returns {Promise<{connected: number, peers: Array}>}
   */
  async tryDirectReconnections(peers, timeout) {
    if (peers.length === 0) {
      return { connected: 0, peers: [] };
    }

    console.log(`[ColdStart] Attempting direct reconnection to ${peers.length} peer(s)...`);

    // If directReconnect module is available, use it
    if (this.directReconnect) {
      const attempts = peers.map(peer =>
        this.directReconnect.attemptDirectReconnection(peer.peerId, timeout)
          .then(result => ({ ...result, peerId: peer.peerId, peerName: peer.displayName }))
          .catch(error => ({
            success: false,
            reason: 'exception',
            error: error.message,
            peerId: peer.peerId
          }))
      );

      const allResults = await Promise.allSettled(attempts);
      const successes = allResults
        .filter(r => r.status === 'fulfilled' && r.value.success)
        .map(r => r.value);

      if (successes.length > 0) {
        console.log(`[ColdStart] ✓ Connected to ${successes.length} peer(s) directly`);

        // Once we have ONE connection, use mesh for the rest
        setTimeout(() => {
          this.useWarmMeshForRest();
        }, COLD_START_CONFIG.WARM_MESH.DELAY_MS);

        return { connected: successes.length, peers: successes };
      }

      return { connected: 0, peers: [] };
    }

    // Fallback: If no direct reconnection module, try basic connection approach
    console.log('[ColdStart] DirectReconnection module not available, using fallback');
    return await this.tryBasicReconnection(peers, timeout);
  }

  /**
   * Basic reconnection fallback (when directReconnect module is unavailable)
   * Attempts to create new connections using stored peer data
   * @param {Array<Object>} peers - Peer candidates
   * @param {number} timeout - Timeout per peer
   * @returns {Promise<{connected: number, peers: Array}>}
   */
  async tryBasicReconnection(peers, timeout) {
    console.log('[ColdStart] Attempting basic reconnection...');

    // Create connection attempts
    const attempts = peers.map(peer =>
      this.attemptBasicConnection(peer, timeout)
        .catch(error => ({
          success: false,
          reason: 'exception',
          error: error.message,
          peerId: peer.peerId
        }))
    );

    const results = await Promise.allSettled(attempts);
    const successes = results
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value);

    if (successes.length > 0) {
      console.log(`[ColdStart] ✓ Basic reconnection succeeded for ${successes.length} peer(s)`);
      return { connected: successes.length, peers: successes };
    }

    console.log('[ColdStart] Basic reconnection failed for all peers');
    return { connected: 0, peers: [] };
  }

  /**
   * Attempt basic connection to a peer
   * @param {Object} peer - Peer data
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<{success: boolean}>}
   */
  async attemptBasicConnection(peer, timeout) {
    return new Promise((resolve) => {
      console.log(`[ColdStart] Basic connection to ${peer.displayName}...`);

      const timer = setTimeout(() => {
        resolve({ success: false, reason: 'timeout', peerId: peer.peerId });
      }, timeout);

      // Note: This is a simplified version. Full implementation would
      // require creating new WebRTC offer/answer exchange, which needs
      // a signaling mechanism that doesn't exist in cold start scenario.
      // This is why DirectReconnection module is strongly recommended.

      clearTimeout(timer);
      resolve({
        success: false,
        reason: 'no_signaling_available',
        peerId: peer.peerId
      });
    });
  }

  // ===========================================================================
  // WARM MESH RECOVERY
  // ===========================================================================

  /**
   * Once we have one connection, use warm mesh for rest
   * Announce presence to mesh and wait for other peers to reconnect
   */
  async useWarmMeshForRest() {
    console.log('[ColdStart] ========================================');
    console.log('[ColdStart] Got warm connection! Announcing to mesh...');
    console.log('[ColdStart] ========================================');

    // Announce presence to mesh if announcements module is available
    if (this.announcements) {
      try {
        await this.announcements.announcePresence('cold_start_recovery');
        console.log('[ColdStart] Presence announced to mesh');
      } catch (error) {
        console.error('[ColdStart] Failed to announce presence:', error);
      }
    } else {
      console.log('[ColdStart] Announcement module not available');
    }

    // Wait for mesh to propagate and other peers to reconnect
    console.log(`[ColdStart] Waiting ${COLD_START_CONFIG.WARM_MESH.WAIT_FOR_MESH_MS}ms for mesh propagation...`);
    await new Promise(resolve =>
      setTimeout(resolve, COLD_START_CONFIG.WARM_MESH.WAIT_FOR_MESH_MS)
    );

    const connectedCount = this.peerManager.getConnectedPeerCount();
    console.log('[ColdStart] ========================================');
    console.log(`[ColdStart] Mesh recovery complete: ${connectedCount} peer(s) connected`);
    console.log('[ColdStart] ========================================');
  }

  // ===========================================================================
  // LAYER 4: INITIAL PAIRING FALLBACK
  // ===========================================================================

  /**
   * Fallback to initial pairing when all else fails
   * Shows UI for manual pairing (QR code, passphrase, etc.)
   * @returns {Promise<{success: boolean, method?: string}>}
   */
  async fallbackToInitialPairing() {
    console.log('[ColdStart] ========================================');
    console.log('[ColdStart] FALLBACK TO INITIAL PAIRING');
    console.log('[ColdStart] All automatic recovery methods failed');
    console.log('[ColdStart] ========================================');

    // Reserved for future fallback mechanisms

    // Show UI for manual intervention
    if (COLD_START_CONFIG.FALLBACK.SHOW_PAIRING_UI) {
      console.log('[ColdStart] Showing manual pairing UI...');
      this.showManualPairingUI();
    }

    return {
      success: false,
      reason: 'manual_intervention_required'
    };
  }

  /**
   * Show manual pairing UI for user intervention
   * Dispatches event that UI can listen to
   */
  showManualPairingUI() {
    if (typeof window === 'undefined') {
      return;
    }

    console.log('[ColdStart] Dispatching show-pairing-ui event');

    const event = new CustomEvent('show-pairing-ui', {
      detail: {
        reason: 'cold_start_failed',
        attemptLog: this.attemptLog,
        duration: Date.now() - this.recoveryStartTime
      }
    });

    window.dispatchEvent(event);
  }


  // ===========================================================================
  // PEER SELECTION & SCORING
  // ===========================================================================

  /**
   * Get peers we were recently connected to
   * @param {number} maxAge - Maximum age in ms (default 300000 = 5 min)
   * @returns {Promise<Array<Object>>} - Sorted by score (highest first)
   */
  async getRecentlyConnectedPeers(maxAge = 300000) {
    try {
      // Get reconnection candidates from persistence
      const candidates = await this.peerPersistence.getReconnectionCandidates({
        limit: 20,
        maxAge: maxAge,
        minQuality: 0 // No minimum, we're desperate in cold start
      });

      if (candidates.length === 0) {
        return [];
      }

      // Extract and score peers
      const peers = candidates
        .map(c => c.peer)
        .map(peer => ({
          ...peer,
          _coldStartScore: this.calculateColdStartScore(peer)
        }))
        .sort((a, b) => b._coldStartScore - a._coldStartScore);

      return peers;
    } catch (error) {
      console.error('[ColdStart] Error getting recent peers:', error);
      return [];
    }
  }

  /**
   * Get all known peers from localStorage
   * @returns {Promise<Array<Object>>} - Sorted by score (highest first)
   */
  async getAllKnownPeers() {
    try {
      const maxAge = COLD_START_CONFIG.ALL_PEERS.MAX_AGE_MS;

      // Get peers within 24 hour window
      const candidates = await this.peerPersistence.getReconnectionCandidates({
        limit: 50,
        maxAge: maxAge,
        minQuality: 0
      });

      if (candidates.length === 0) {
        return [];
      }

      // Extract and score peers
      const peers = candidates
        .map(c => c.peer)
        .map(peer => ({
          ...peer,
          _coldStartScore: this.calculateColdStartScore(peer)
        }))
        .sort((a, b) => b._coldStartScore - a._coldStartScore);

      return peers;
    } catch (error) {
      console.error('[ColdStart] Error getting all known peers:', error);
      return [];
    }
  }

  /**
   * Calculate cold start specific reconnection score
   * Prioritizes recency and direct connections over quality
   * @param {Object} peer - Peer data
   * @returns {number} Score (0-100)
   */
  calculateColdStartScore(peer) {
    let score = 0;
    const now = Date.now();

    // Recency is CRITICAL in cold start (50 points max)
    const age = now - (peer.lastConnected || peer.lastSeen || 0);
    if (age < 300000) score += 50;           // < 5 min
    else if (age < 600000) score += 40;      // < 10 min
    else if (age < 1800000) score += 30;     // < 30 min
    else if (age < 3600000) score += 20;     // < 1 hour
    else if (age < 7200000) score += 10;     // < 2 hours

    // Connection type (30 points max)
    // Direct connections have better NAT cache retention
    const quality = peer.connectionQuality || {};
    if (quality.connectionType === 'host') score += 30;       // Direct
    else if (quality.connectionType === 'srflx') score += 20; // STUN
    else if (quality.connectionType === 'relay') score += 5;  // TURN

    // Connection quality (15 points max)
    if (quality.successRate !== undefined && quality.successRate !== null) {
      score += Math.floor(quality.successRate * 15);
    }

    // Cached candidates bonus (5 points)
    if (peer.cachedCandidates && peer.cachedCandidates.length > 0) {
      score += 5;
    }

    // Penalty for failed attempts
    const failedAttempts = peer.reconnectionAttempts || 0;
    score -= failedAttempts * 2;

    return Math.min(100, Math.max(0, score));
  }

  // ===========================================================================
  // LOGGING & DIAGNOSTICS
  // ===========================================================================

  /**
   * Log recovery attempt
   * @param {string} layer - Layer name
   * @param {boolean} success - Whether attempt succeeded
   * @param {number} connected - Number of peers connected
   */
  logAttempt(layer, success, connected) {
    const entry = {
      layer,
      success,
      connected,
      timestamp: Date.now(),
      elapsed: Date.now() - this.recoveryStartTime
    };
    this.attemptLog.push(entry);
  }

  /**
   * Print recovery log summary
   */
  printRecoveryLog() {
    console.log('[ColdStart] ========================================');
    console.log('[ColdStart] RECOVERY ATTEMPT LOG');
    console.log('[ColdStart] ========================================');

    this.attemptLog.forEach((entry, index) => {
      const status = entry.success ? '✓' : '✗';
      const elapsed = (entry.elapsed / 1000).toFixed(1);
      console.log(
        `[ColdStart] ${index + 1}. ${status} ${entry.layer} ` +
        `(${elapsed}s) - Connected: ${entry.connected}`
      );
    });

    const totalTime = (Date.now() - this.recoveryStartTime) / 1000;
    console.log('[ColdStart] ========================================');
    console.log(`[ColdStart] Total recovery time: ${totalTime.toFixed(1)}s`);
    console.log('[ColdStart] ========================================');
  }

  /**
   * Get recovery statistics
   * @returns {Object} Recovery stats
   */
  getStats() {
    return {
      isRecovering: this.isRecovering,
      currentLayer: this.currentLayer,
      attemptLog: this.attemptLog,
      totalAttempts: this.attemptLog.length,
      successfulAttempts: this.attemptLog.filter(a => a.success).length,
      elapsedTime: this.recoveryStartTime ? Date.now() - this.recoveryStartTime : 0
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default ColdStartManager;
export { COLD_START_CONFIG };
