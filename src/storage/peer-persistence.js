/**
 * Comprehensive localStorage schema for persisting peer information
 * Enables automatic reconnection in P2P mesh chat application
 *
 * Features:
 * - Encrypted storage of sensitive data (shared secrets)
 * - Connection quality metrics for prioritization
 * - Stale peer cleanup with multiple strategies
 * - Efficient queries for reconnection candidates
 * - Storage quota management
 * - Schema versioning and migration
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

export const STORAGE_CONFIG = {
  // Storage keys
  KEYS: {
    PEERS_INDEX: 'mesh:peers:index',           // Array of peer IDs
    PEER_PREFIX: 'mesh:peer:',                 // Individual peer data
    METADATA: 'mesh:peers:metadata',           // Global metadata
    ENCRYPTION_KEY: 'mesh:encryption:key',     // Encrypted at-rest key
    SCHEMA_VERSION: 'mesh:schema:version',     // Schema version
  },

  // Storage limits
  MAX_PEERS: 100,                              // Maximum peers to store
  MAX_STORAGE_MB: 5,                           // Target max storage (5MB)
  CLEANUP_THRESHOLD: 0.8,                      // Trigger cleanup at 80% capacity

  // Retention policies
  RETENTION: {
    ACTIVE_DAYS: 7,                            // Keep peers seen in last 7 days
    INACTIVE_DAYS: 30,                         // Remove peers not seen in 30 days
    FAILED_ATTEMPTS: 5,                        // Max failed reconnection attempts
    BLACKLIST_DURATION: 24 * 60 * 60 * 1000,  // 24 hours
  },

  // Schema version
  CURRENT_VERSION: '1.0.0',
};

// =============================================================================
// TYPE DEFINITIONS (JSDoc for TypeScript-like checking)
// =============================================================================

/**
 * @typedef {Object} PeerConnectionQuality
 * @property {number} latency - Average latency in ms
 * @property {number} successRate - Connection success rate (0-1)
 * @property {string} connectionType - 'host', 'srflx', 'relay'
 * @property {number} lastMeasured - Timestamp of last measurement
 * @property {number} totalConnections - Total connection attempts
 * @property {number} successfulConnections - Successful connections
 * @property {number} avgUptime - Average connection uptime in seconds
 */

/**
 * @typedef {Object} PeerICECandidate
 * @property {string} candidate - ICE candidate string
 * @property {string} sdpMid - Media stream ID
 * @property {number} sdpMLineIndex - Media line index
 * @property {string} type - Candidate type: 'host', 'srflx', 'relay'
 */

/**
 * @typedef {Object} PeerData
 * @property {string} peerId - Unique peer identifier
 * @property {string} userId - User ID associated with peer
 * @property {string} displayName - Display name
 * @property {number} firstSeen - Timestamp when first encountered
 * @property {number} lastSeen - Timestamp of last activity
 * @property {number} lastConnected - Timestamp of last successful connection
 * @property {string} publicKey - Public key (JWK format, JSON string)
 * @property {string} encryptedSecret - Encrypted shared secret
 * @property {string} lastKnownIP - Last known IP address (if available)
 * @property {Array<Object>} iceServers - ICE servers configuration
 * @property {Array<PeerICECandidate>} cachedCandidates - Cached ICE candidates
 * @property {PeerConnectionQuality} connectionQuality - Connection metrics
 * @property {number} reconnectionAttempts - Failed reconnection attempts
 * @property {number|null} blacklistUntil - Timestamp when blacklist expires
 * @property {Object} metadata - Additional peer metadata
 * @property {number} dataVersion - Schema version for this peer
 */

/**
 * @typedef {Object} StorageMetadata
 * @property {number} lastCleanup - Timestamp of last cleanup
 * @property {number} totalPeers - Total number of stored peers
 * @property {number} estimatedSize - Estimated storage size in bytes
 * @property {Object} statistics - Usage statistics
 */

/**
 * @typedef {Object} ReconnectionCandidate
 * @property {PeerData} peer - Peer data
 * @property {number} score - Reconnection priority score (0-100)
 * @property {string} reason - Why this peer was selected
 */

// =============================================================================
// ENCRYPTION UTILITIES
// =============================================================================

class EncryptionManager {
  constructor() {
    this.masterKey = null;
    this.algorithm = {
      name: 'AES-GCM',
      length: 256,
    };
  }

  /**
   * Initialize or retrieve master encryption key
   * Note: In production, consider deriving from user password or session key
   */
  async getMasterKey() {
    if (this.masterKey) return this.masterKey;

    // Check if key exists in storage
    const stored = localStorage.getItem(STORAGE_CONFIG.KEYS.ENCRYPTION_KEY);

    if (stored) {
      // Import existing key
      const keyData = JSON.parse(stored);
      this.masterKey = await crypto.subtle.importKey(
        'jwk',
        keyData,
        this.algorithm,
        true,
        ['encrypt', 'decrypt']
      );
    } else {
      // Generate new key
      this.masterKey = await crypto.subtle.generateKey(
        this.algorithm,
        true,
        ['encrypt', 'decrypt']
      );

      // Export and store
      const exported = await crypto.subtle.exportKey('jwk', this.masterKey);
      localStorage.setItem(
        STORAGE_CONFIG.KEYS.ENCRYPTION_KEY,
        JSON.stringify(exported)
      );
    }

    return this.masterKey;
  }

  /**
   * Encrypt data using AES-GCM
   * @param {string} plaintext - Data to encrypt
   * @returns {Promise<string>} Base64-encoded encrypted data with IV
   */
  async encrypt(plaintext) {
    const key = await this.getMasterKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );

    // Combine IV and ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    // Convert to base64
    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt data using AES-GCM
   * @param {string} encrypted - Base64-encoded encrypted data
   * @returns {Promise<string>} Decrypted plaintext
   */
  async decrypt(encrypted) {
    try {
      const key = await this.getMasterKey();
      const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));

      // Extract IV and ciphertext
      const iv = combined.slice(0, 12);
      const ciphertext = combined.slice(12);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      );

      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.error('[Encryption] Decryption failed:', e);
      return null;
    }
  }

  /**
   * Clear encryption key (on logout)
   */
  clearKey() {
    this.masterKey = null;
    localStorage.removeItem(STORAGE_CONFIG.KEYS.ENCRYPTION_KEY);
  }
}

const encryption = new EncryptionManager();

// =============================================================================
// PEER PERSISTENCE MANAGER
// =============================================================================

class PeerPersistenceManager {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize storage and run migrations if needed
   */
  async initialize() {
    if (this.initialized) return;

    await this.checkAndMigrate();
    await this.loadMetadata();
    this.initialized = true;
  }

  // ===========================================================================
  // CRUD OPERATIONS
  // ===========================================================================

  /**
   * Store or update peer data
   * @param {PeerData} peerData - Peer data to store
   * @returns {Promise<boolean>} Success status
   */
  async storePeer(peerData) {
    try {
      await this.initialize();

      // Encrypt sensitive data
      const encryptedData = { ...peerData };
      if (peerData.sharedSecret) {
        encryptedData.encryptedSecret = await encryption.encrypt(
          peerData.sharedSecret
        );
        delete encryptedData.sharedSecret;
      }

      // Add version
      encryptedData.dataVersion = STORAGE_CONFIG.CURRENT_VERSION;

      // Store peer data
      const key = STORAGE_CONFIG.KEYS.PEER_PREFIX + peerData.peerId;
      localStorage.setItem(key, JSON.stringify(encryptedData));

      // Update index
      await this.addToIndex(peerData.peerId);

      // Update metadata
      await this.updateMetadata();

      return true;
    } catch (e) {
      console.error('[PeerPersistence] Failed to store peer:', e);
      return false;
    }
  }

  /**
   * Retrieve peer data
   * @param {string} peerId - Peer ID to retrieve
   * @returns {Promise<PeerData|null>} Peer data or null
   */
  async getPeer(peerId) {
    try {
      await this.initialize();

      const key = STORAGE_CONFIG.KEYS.PEER_PREFIX + peerId;
      const stored = localStorage.getItem(key);

      if (!stored) return null;

      const peerData = JSON.parse(stored);

      // Decrypt sensitive data
      if (peerData.encryptedSecret) {
        peerData.sharedSecret = await encryption.decrypt(
          peerData.encryptedSecret
        );
        delete peerData.encryptedSecret;
      }

      return peerData;
    } catch (e) {
      console.error('[PeerPersistence] Failed to get peer:', e);
      return null;
    }
  }

  /**
   * Remove peer data
   * @param {string} peerId - Peer ID to remove
   * @returns {Promise<boolean>} Success status
   */
  async removePeer(peerId) {
    try {
      await this.initialize();

      const key = STORAGE_CONFIG.KEYS.PEER_PREFIX + peerId;
      localStorage.removeItem(key);

      await this.removeFromIndex(peerId);
      await this.updateMetadata();

      return true;
    } catch (e) {
      console.error('[PeerPersistence] Failed to remove peer:', e);
      return false;
    }
  }

  /**
   * Update peer's last seen timestamp
   * @param {string} peerId - Peer ID
   * @returns {Promise<boolean>} Success status
   */
  async updateLastSeen(peerId) {
    const peer = await this.getPeer(peerId);
    if (!peer) return false;

    peer.lastSeen = Date.now();
    return await this.storePeer(peer);
  }

  /**
   * Update peer's connection quality metrics
   * @param {string} peerId - Peer ID
   * @param {Partial<PeerConnectionQuality>} quality - Quality metrics to update
   * @returns {Promise<boolean>} Success status
   */
  async updateConnectionQuality(peerId, quality) {
    const peer = await this.getPeer(peerId);
    if (!peer) return false;

    peer.connectionQuality = {
      ...peer.connectionQuality,
      ...quality,
      lastMeasured: Date.now(),
    };

    peer.lastConnected = Date.now();
    peer.reconnectionAttempts = 0; // Reset on successful connection

    return await this.storePeer(peer);
  }

  /**
   * Increment failed reconnection attempts
   * @param {string} peerId - Peer ID
   * @returns {Promise<boolean>} Success status
   */
  async incrementReconnectionAttempts(peerId) {
    const peer = await this.getPeer(peerId);
    if (!peer) return false;

    peer.reconnectionAttempts = (peer.reconnectionAttempts || 0) + 1;

    // Only blacklist peers that have NEVER successfully connected
    // Don't blacklist peers from previous successful sessions
    const hasSuccessfulHistory = peer.connectionQuality &&
                                 peer.connectionQuality.successfulConnections > 0;

    if (!hasSuccessfulHistory &&
        peer.reconnectionAttempts >= STORAGE_CONFIG.RETENTION.FAILED_ATTEMPTS) {
      peer.blacklistUntil = Date.now() + STORAGE_CONFIG.RETENTION.BLACKLIST_DURATION;
    }

    return await this.storePeer(peer);
  }

  /**
   * Update peer's public key from trust store
   * @param {string} peerId - Peer ID
   * @param {Object} publicKey - Public key (JWK format)
   * @returns {Promise<boolean>} Success status
   */
  async updatePeerPublicKey(peerId, publicKey) {
    const peer = await this.getPeer(peerId);
    if (!peer) return false;

    peer.publicKey = JSON.stringify(publicKey);
    return await this.storePeer(peer);
  }

  /**
   * Update peer's shared secret from session keys
   * @param {string} peerId - Peer ID
   * @param {string} sharedSecret - Shared secret (hex string)
   * @returns {Promise<boolean>} Success status
   */
  async updatePeerSharedSecret(peerId, sharedSecret) {
    const peer = await this.getPeer(peerId);
    if (!peer) return false;

    peer.sharedSecret = sharedSecret;
    return await this.storePeer(peer);
  }

  /**
   * Update peer with partial data (merge updates)
   * @param {string} peerId - Peer ID
   * @param {Object} updates - Partial peer data to merge
   * @returns {Promise<boolean>} Success status
   */
  async updatePeer(peerId, updates) {
    const peer = await this.getPeer(peerId);
    if (!peer) return false;

    // Merge updates into peer object
    Object.assign(peer, updates);
    return await this.storePeer(peer);
  }

  // ===========================================================================
  // QUERY OPERATIONS
  // ===========================================================================

  /**
   * Get all stored peer IDs
   * @returns {Promise<string[]>} Array of peer IDs
   */
  async getAllPeerIds() {
    await this.initialize();

    const stored = localStorage.getItem(STORAGE_CONFIG.KEYS.PEERS_INDEX);
    return stored ? JSON.parse(stored) : [];
  }

  /**
   * Get all peers sorted by criteria
   * @param {Object} options - Query options
   * @returns {Promise<PeerData[]>} Sorted peer data
   */
  async queryPeers(options = {}) {
    const {
      sortBy = 'lastSeen',          // 'lastSeen', 'quality', 'lastConnected'
      order = 'desc',                // 'asc', 'desc'
      limit = null,                  // Maximum results
      minQuality = 0,                // Minimum quality score
      maxAge = null,                 // Maximum age in ms
      excludeBlacklisted = true,     // Exclude blacklisted peers
    } = options;

    await this.initialize();

    const peerIds = await this.getAllPeerIds();
    const peers = [];

    const now = Date.now();

    for (const peerId of peerIds) {
      const peer = await this.getPeer(peerId);
      if (!peer) continue;

      // Filter blacklisted
      if (excludeBlacklisted && peer.blacklistUntil && peer.blacklistUntil > now) {
        continue;
      }

      // Filter by age
      if (maxAge && (now - peer.lastSeen) > maxAge) {
        continue;
      }

      // Calculate quality score
      const qualityScore = this.calculateQualityScore(peer);

      // Filter by minimum quality
      if (qualityScore < minQuality) {
        continue;
      }

      peers.push({ ...peer, _qualityScore: qualityScore });
    }

    // Sort
    peers.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'quality':
          comparison = (b._qualityScore || 0) - (a._qualityScore || 0);
          break;
        case 'lastConnected':
          comparison = (b.lastConnected || 0) - (a.lastConnected || 0);
          break;
        case 'lastSeen':
        default:
          comparison = (b.lastSeen || 0) - (a.lastSeen || 0);
          break;
      }

      return order === 'asc' ? -comparison : comparison;
    });

    // Limit results
    return limit ? peers.slice(0, limit) : peers;
  }

  /**
   * Get reconnection candidates sorted by priority
   * @param {Object} options - Query options
   * @returns {Promise<ReconnectionCandidate[]>} Sorted candidates
   */
  async getReconnectionCandidates(options = {}) {
    const {
      limit = 10,
      maxAge = 7 * 24 * 60 * 60 * 1000, // 7 days
      minQuality = 0,
    } = options;

    const peers = await this.queryPeers({
      sortBy: 'quality',
      limit: limit * 2, // Get more for scoring
      maxAge,
      minQuality,
      excludeBlacklisted: true,
    });

    // Calculate reconnection priority scores
    const candidates = peers.map(peer => ({
      peer,
      score: this.calculateReconnectionScore(peer),
      reason: this.getReconnectionReason(peer),
    }));

    // Sort by score
    candidates.sort((a, b) => b.score - a.score);

    return candidates.slice(0, limit);
  }

  /**
   * Calculate quality score for a peer (0-100)
   * @param {PeerData} peer - Peer data
   * @returns {number} Quality score
   */
  calculateQualityScore(peer) {
    let score = 0;
    const quality = peer.connectionQuality;

    if (!quality) return 0;

    // Latency score (40 points)
    if (quality.latency !== null && quality.latency !== undefined) {
      if (quality.latency < 50) score += 40;
      else if (quality.latency < 100) score += 35;
      else if (quality.latency < 200) score += 25;
      else if (quality.latency < 500) score += 15;
      else if (quality.latency < 1000) score += 5;
    }

    // Connection success rate (30 points)
    if (quality.successRate !== null && quality.successRate !== undefined) {
      score += Math.floor(quality.successRate * 30);
    }

    // Connection type (20 points)
    if (quality.connectionType) {
      if (quality.connectionType === 'host') score += 20;
      else if (quality.connectionType === 'srflx') score += 12;
      else if (quality.connectionType === 'relay') score += 5;
    }

    // Uptime stability (10 points)
    if (quality.avgUptime !== null && quality.avgUptime !== undefined) {
      if (quality.avgUptime > 600) score += 10;      // 10+ minutes
      else if (quality.avgUptime > 300) score += 7;  // 5+ minutes
      else if (quality.avgUptime > 60) score += 4;   // 1+ minute
    }

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Calculate reconnection priority score (0-100)
   * @param {PeerData} peer - Peer data
   * @returns {number} Reconnection score
   */
  calculateReconnectionScore(peer) {
    const now = Date.now();
    const quality = peer.connectionQuality || {};

    // Base score from connection quality (40% weight)
    let score = this.calculateQualityScore(peer) * 0.4;

    // Recency bonus (30% weight)
    const daysSinceLastSeen = (now - peer.lastSeen) / (1000 * 60 * 60 * 24);
    if (daysSinceLastSeen < 1) score += 30;
    else if (daysSinceLastSeen < 3) score += 20;
    else if (daysSinceLastSeen < 7) score += 10;

    // Successful connections bonus (20% weight)
    if (quality.successfulConnections) {
      const connectionBonus = Math.min(20, quality.successfulConnections * 2);
      score += connectionBonus;
    }

    // Reliability bonus (10% weight)
    const failureRate = peer.reconnectionAttempts / (quality.totalConnections || 1);
    if (failureRate < 0.1) score += 10;
    else if (failureRate < 0.3) score += 5;

    // Penalty for failed attempts
    score -= peer.reconnectionAttempts * 5;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Get reason for reconnection priority
   * @param {PeerData} peer - Peer data
   * @returns {string} Reason description
   */
  getReconnectionReason(peer) {
    const quality = peer.connectionQuality || {};
    const reasons = [];

    if (quality.latency && quality.latency < 100) {
      reasons.push('low-latency');
    }

    if (quality.connectionType === 'host') {
      reasons.push('direct-connection');
    }

    if (quality.successRate > 0.8) {
      reasons.push('reliable');
    }

    const daysSinceLastSeen = (Date.now() - peer.lastSeen) / (1000 * 60 * 60 * 24);
    if (daysSinceLastSeen < 1) {
      reasons.push('recently-active');
    }

    return reasons.length > 0 ? reasons.join(', ') : 'available';
  }

  // ===========================================================================
  // CLEANUP OPERATIONS
  // ===========================================================================

  /**
   * Clean up stale peers based on retention policies
   * @returns {Promise<number>} Number of peers removed
   */
  async cleanupStalePeers() {
    await this.initialize();

    const now = Date.now();
    const peerIds = await this.getAllPeerIds();
    let removed = 0;

    for (const peerId of peerIds) {
      const peer = await this.getPeer(peerId);
      if (!peer) continue;

      let shouldRemove = false;
      let reason = '';

      // Remove if not seen in INACTIVE_DAYS
      const daysSinceLastSeen = (now - peer.lastSeen) / (1000 * 60 * 60 * 24);
      if (daysSinceLastSeen > STORAGE_CONFIG.RETENTION.INACTIVE_DAYS) {
        shouldRemove = true;
        reason = 'inactive';
      }

      // Remove if too many failed attempts and blacklist expired
      if (peer.reconnectionAttempts >= STORAGE_CONFIG.RETENTION.FAILED_ATTEMPTS) {
        if (!peer.blacklistUntil || peer.blacklistUntil < now) {
          shouldRemove = true;
          reason = 'failed-reconnections';
        }
      }

      if (shouldRemove) {
        await this.removePeer(peerId);
        removed++;
      }
    }

    // LRU cleanup if still over limit
    const remainingPeerIds = await this.getAllPeerIds();
    if (remainingPeerIds.length > STORAGE_CONFIG.MAX_PEERS) {
      const excess = remainingPeerIds.length - STORAGE_CONFIG.MAX_PEERS;
      await this.cleanupLRU(excess);
      removed += excess;
    }

    await this.updateMetadata({ lastCleanup: now });

    return removed;
  }

  /**
   * Remove least recently used peers
   * @param {number} count - Number of peers to remove
   * @returns {Promise<number>} Number of peers removed
   */
  async cleanupLRU(count) {
    const peers = await this.queryPeers({
      sortBy: 'lastSeen',
      order: 'asc', // Oldest first
      limit: count,
    });

    let removed = 0;
    for (const peer of peers) {
      await this.removePeer(peer.peerId);
      removed++;
    }

    return removed;
  }

  /**
   * Clear all expired blacklists
   * @returns {Promise<number>} Number of blacklists cleared
   */
  async clearExpiredBlacklists() {
    await this.initialize();

    const now = Date.now();
    const peerIds = await this.getAllPeerIds();
    let cleared = 0;

    for (const peerId of peerIds) {
      const peer = await this.getPeer(peerId);
      if (!peer) continue;

      if (peer.blacklistUntil && peer.blacklistUntil < now) {
        peer.blacklistUntil = null;
        peer.reconnectionAttempts = 0;
        await this.storePeer(peer);
        cleared++;
      }
    }

    return cleared;
  }

  // ===========================================================================
  // STORAGE MANAGEMENT
  // ===========================================================================

  /**
   * Estimate storage usage
   * @returns {Promise<Object>} Storage statistics
   */
  async getStorageStats() {
    await this.initialize();

    const peerIds = await this.getAllPeerIds();
    let totalSize = 0;

    // Estimate size
    for (const peerId of peerIds) {
      const key = STORAGE_CONFIG.KEYS.PEER_PREFIX + peerId;
      const data = localStorage.getItem(key);
      if (data) {
        totalSize += data.length * 2; // UTF-16 encoding
      }
    }

    const metadata = await this.getMetadata();

    return {
      peerCount: peerIds.length,
      estimatedSizeBytes: totalSize,
      estimatedSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      maxPeers: STORAGE_CONFIG.MAX_PEERS,
      utilizationPercent: ((peerIds.length / STORAGE_CONFIG.MAX_PEERS) * 100).toFixed(1),
      lastCleanup: metadata.lastCleanup,
    };
  }

  /**
   * Check if cleanup is needed
   * @returns {Promise<boolean>} True if cleanup needed
   */
  async needsCleanup() {
    const stats = await this.getStorageStats();
    const metadata = await this.getMetadata();

    // Check peer count
    if (stats.peerCount >= STORAGE_CONFIG.MAX_PEERS * STORAGE_CONFIG.CLEANUP_THRESHOLD) {
      return true;
    }

    // Check last cleanup time (daily cleanup)
    const daysSinceCleanup = (Date.now() - metadata.lastCleanup) / (1000 * 60 * 60 * 24);
    if (daysSinceCleanup > 1) {
      return true;
    }

    return false;
  }

  // ===========================================================================
  // INDEX MANAGEMENT
  // ===========================================================================

  /**
   * Add peer to index
   * @param {string} peerId - Peer ID to add
   */
  async addToIndex(peerId) {
    const peerIds = await this.getAllPeerIds();
    if (!peerIds.includes(peerId)) {
      peerIds.push(peerId);
      localStorage.setItem(
        STORAGE_CONFIG.KEYS.PEERS_INDEX,
        JSON.stringify(peerIds)
      );
    }
  }

  /**
   * Remove peer from index
   * @param {string} peerId - Peer ID to remove
   */
  async removeFromIndex(peerId) {
    const peerIds = await this.getAllPeerIds();
    const filtered = peerIds.filter(id => id !== peerId);
    localStorage.setItem(
      STORAGE_CONFIG.KEYS.PEERS_INDEX,
      JSON.stringify(filtered)
    );
  }

  // ===========================================================================
  // METADATA MANAGEMENT
  // ===========================================================================

  /**
   * Load metadata
   * @returns {Promise<StorageMetadata>} Metadata object
   */
  async loadMetadata() {
    const stored = localStorage.getItem(STORAGE_CONFIG.KEYS.METADATA);

    if (stored) {
      return JSON.parse(stored);
    }

    // Initialize metadata
    const metadata = {
      lastCleanup: Date.now(),
      totalPeers: 0,
      estimatedSize: 0,
      statistics: {
        totalReconnections: 0,
        successfulReconnections: 0,
        failedReconnections: 0,
      },
    };

    localStorage.setItem(
      STORAGE_CONFIG.KEYS.METADATA,
      JSON.stringify(metadata)
    );

    return metadata;
  }

  /**
   * Get current metadata
   * @returns {Promise<StorageMetadata>} Metadata object
   */
  async getMetadata() {
    return await this.loadMetadata();
  }

  /**
   * Update metadata
   * @param {Partial<StorageMetadata>} updates - Metadata updates
   */
  async updateMetadata(updates = {}) {
    const metadata = await this.loadMetadata();
    const stats = await this.getStorageStats();

    const updated = {
      ...metadata,
      ...updates,
      totalPeers: stats.peerCount,
      estimatedSize: stats.estimatedSizeBytes,
    };

    localStorage.setItem(
      STORAGE_CONFIG.KEYS.METADATA,
      JSON.stringify(updated)
    );
  }

  // ===========================================================================
  // MIGRATION & VERSIONING
  // ===========================================================================

  /**
   * Check schema version and migrate if needed
   */
  async checkAndMigrate() {
    const currentVersion = localStorage.getItem(STORAGE_CONFIG.KEYS.SCHEMA_VERSION);

    if (!currentVersion) {
      // First time initialization
      localStorage.setItem(
        STORAGE_CONFIG.KEYS.SCHEMA_VERSION,
        STORAGE_CONFIG.CURRENT_VERSION
      );
      return;
    }

    if (currentVersion !== STORAGE_CONFIG.CURRENT_VERSION) {
      await this.migrate(currentVersion, STORAGE_CONFIG.CURRENT_VERSION);
    }
  }

  /**
   * Migrate data between schema versions
   * @param {string} fromVersion - Source version
   * @param {string} toVersion - Target version
   */
  async migrate(fromVersion, toVersion) {
    // Add migration logic here for future schema changes
    localStorage.setItem(
      STORAGE_CONFIG.KEYS.SCHEMA_VERSION,
      toVersion
    );
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Clear all peer data (logout)
   */
  async clearAll() {
    const peerIds = await this.getAllPeerIds();

    for (const peerId of peerIds) {
      const key = STORAGE_CONFIG.KEYS.PEER_PREFIX + peerId;
      localStorage.removeItem(key);
    }

    localStorage.removeItem(STORAGE_CONFIG.KEYS.PEERS_INDEX);
    localStorage.removeItem(STORAGE_CONFIG.KEYS.METADATA);

    encryption.clearKey();
  }

  /**
   * Export all peer data (for backup)
   * @returns {Promise<Object>} Exported data
   */
  async exportData() {
    await this.initialize();

    const peerIds = await this.getAllPeerIds();
    const peers = [];

    for (const peerId of peerIds) {
      const peer = await this.getPeer(peerId);
      if (peer) {
        // Remove decrypted secrets from export
        const exportPeer = { ...peer };
        delete exportPeer.sharedSecret;
        peers.push(exportPeer);
      }
    }

    return {
      version: STORAGE_CONFIG.CURRENT_VERSION,
      exportDate: Date.now(),
      peers,
    };
  }

  /**
   * Import peer data (from backup)
   * @param {Object} data - Exported data
   * @returns {Promise<number>} Number of peers imported
   */
  async importData(data) {
    let imported = 0;

    for (const peer of data.peers) {
      try {
        await this.storePeer(peer);
        imported++;
      } catch (e) {
        console.error('[PeerPersistence] Failed to import peer:', e);
      }
    }

    return imported;
  }
}

// =============================================================================
// HELPER FUNCTIONS FOR COMMON USE CASES
// =============================================================================

/**
 * Create peer data object with defaults
 * @param {Object} options - Peer options
 * @returns {PeerData} Peer data object
 */
export function createPeerData(options) {
  const now = Date.now();

  return {
    peerId: options.peerId,
    userId: options.userId || options.peerId,
    displayName: options.displayName || 'Unknown',
    firstSeen: now,
    lastSeen: now,
    lastConnected: now,
    publicKey: options.publicKey,
    encryptedSecret: null,
    sharedSecret: options.sharedSecret || null,
    lastKnownIP: options.lastKnownIP || null,
    iceServers: options.iceServers || [],
    cachedCandidates: options.cachedCandidates || [],
    connectionQuality: {
      latency: null,
      successRate: 1.0,
      connectionType: null,
      lastMeasured: now,
      totalConnections: 1,
      successfulConnections: 1,
      avgUptime: 0,
      ...options.connectionQuality,
    },
    reconnectionAttempts: 0,
    blacklistUntil: null,
    metadata: options.metadata || {},
    dataVersion: STORAGE_CONFIG.CURRENT_VERSION,
  };
}

/**
 * Update connection quality after a connection
 * @param {PeerConnectionQuality} current - Current quality metrics
 * @param {Object} newMetrics - New measurements
 * @returns {PeerConnectionQuality} Updated quality metrics
 */
export function updateQualityMetrics(current, newMetrics) {
  const updated = { ...current };

  // Update latency (moving average)
  if (newMetrics.latency !== null && newMetrics.latency !== undefined) {
    if (current.latency === null) {
      updated.latency = newMetrics.latency;
    } else {
      updated.latency = Math.round(current.latency * 0.7 + newMetrics.latency * 0.3);
    }
  }

  // Update connection type
  if (newMetrics.connectionType) {
    updated.connectionType = newMetrics.connectionType;
  }

  // Update success rate
  updated.totalConnections = (current.totalConnections || 0) + 1;
  if (newMetrics.success) {
    updated.successfulConnections = (current.successfulConnections || 0) + 1;
  }
  updated.successRate = updated.successfulConnections / updated.totalConnections;

  // Update average uptime
  if (newMetrics.uptime) {
    const prevAvg = current.avgUptime || 0;
    const count = updated.successfulConnections;
    updated.avgUptime = Math.round((prevAvg * (count - 1) + newMetrics.uptime) / count);
  }

  updated.lastMeasured = Date.now();

  return updated;
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

const peerPersistence = new PeerPersistenceManager();
export default peerPersistence;

// Also export the class for testing
export { PeerPersistenceManager, EncryptionManager };
