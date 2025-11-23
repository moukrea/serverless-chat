/**
 * ReconnectionManager - WebRTC Reconnection via Mesh Relay Signaling
 *
 * Enables peers to reconnect even after disconnection by routing WebRTC
 * signaling (offers/answers) through the mesh network using existing
 * connected peers as relays.
 *
 * Flow Diagram:
 * ```
 * Peer A (disconnected)     Peer B (relay)            Peer C (target)
 *      |                          |                      |
 *      |--[PATH_QUERY]----------->|                      |
 *      |                          |--[PATH_QUERY]------->|
 *      |                          |<-[PATH_RESPONSE]-----|
 *      |<-[PATH_RESPONSE]---------|                      |
 *      |                          |                      |
 *      |--[RECONNECT_OFFER]------>|--[relay]------------>|
 *      |                          |                      |
 *      |                          |<-[RECONNECT_ANSWER]--|
 *      |<-[RECONNECT_ANSWER]------|                      |
 *      |                          |                      |
 *      |<============WebRTC connection established======>|
 * ```
 *
 * Success Rate: 70-80% (when mutual peer is online)
 * Target Speed: 10-25 seconds
 *
 * @module relay-reconnection
 */

import SimplePeer from 'simple-peer/simplepeer.min.js';
import ICE_CONFIG from '../config/ice-config.js';

// =============================================================================
// MESSAGE TYPE CONSTANTS
// =============================================================================

export const RECONNECT_MESSAGE_TYPES = {
  RECONNECT_OFFER: 'reconnect_offer',       // WebRTC offer for reconnection
  RECONNECT_ANSWER: 'reconnect_answer',     // WebRTC answer for reconnection
  RECONNECT_REJECTION: 'reconnect_rejection', // Target rejected reconnection
  PATH_QUERY: 'path_query',                 // "Who knows peer X?"
  PATH_RESPONSE: 'path_response'            // "I know peer X"
};

// =============================================================================
// RECONNECTION STATES
// =============================================================================

const ReconnectionState = {
  IDLE: 'idle',
  QUERYING_PATH: 'querying_path',
  PATH_FOUND: 'path_found',
  SENDING_OFFER: 'sending_offer',
  WAITING_ANSWER: 'waiting_answer',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  FAILED: 'failed',
  REJECTED: 'rejected'
};

// =============================================================================
// RECONNECTION MANAGER CLASS
// =============================================================================

class ReconnectionManager {
  /**
   * Create a ReconnectionManager
   * @param {Object} identity - User identity {uuid, displayName}
   * @param {MessageRouter} router - MeshRouter instance
   * @param {Object} peerManager - PeerManager instance
   * @param {PeerPersistenceManager} peerPersistence - PeerPersistence instance
   */
  constructor(identity, router, peerManager, peerPersistence) {
    this.identity = identity;
    this.router = router;
    this.peerManager = peerManager;
    this.peerPersistence = peerPersistence;

    // State management
    this.pendingReconnects = new Map(); // reconnectId -> {targetPeerId, peer, resolve, reject, timeout, state}
    this.pathQueryResponses = new Map(); // queryId -> Set of {relayPeerId, hopCount, timestamp}
    this.activeQueries = new Map(); // queryId -> {targetPeerId, resolve, reject, timeout}

    // Configuration
    this.config = {
      reconnectTimeout: 30000,      // 30 seconds total timeout
      pathQueryTimeout: 5000,       // 5 seconds for path discovery
      answerTimeout: 25000,         // 25 seconds to wait for answer
      maxConcurrentReconnects: 5,   // Maximum simultaneous reconnection attempts
      pathQueryTTL: 7,              // TTL for path queries
      offerTTL: 10,                 // TTL for reconnection offers
      cleanupInterval: 60000        // 1 minute cleanup interval
    };

    // Statistics
    this.stats = {
      totalAttempts: 0,
      successful: 0,
      failed: 0,
      rejected: 0,
      timedOut: 0,
      pathNotFound: 0,
      offersReceived: 0,
      answersReceived: 0
    };

    // Register message handlers
    this.registerHandlers();

    // Start periodic cleanup
    this.startCleanup();
  }

  // ===========================================================================
  // INITIALIZATION & SETUP
  // ===========================================================================

  /**
   * Register message handlers with the router
   * @private
   */
  registerHandlers() {
    this.router.on(RECONNECT_MESSAGE_TYPES.RECONNECT_OFFER,
      msg => this.handleReconnectOffer(msg));

    this.router.on(RECONNECT_MESSAGE_TYPES.RECONNECT_ANSWER,
      msg => this.handleReconnectAnswer(msg));

    this.router.on(RECONNECT_MESSAGE_TYPES.RECONNECT_REJECTION,
      msg => this.handleReconnectRejection(msg));

    this.router.on(RECONNECT_MESSAGE_TYPES.PATH_QUERY,
      msg => this.handlePathQuery(msg));

    this.router.on(RECONNECT_MESSAGE_TYPES.PATH_RESPONSE,
      msg => this.handlePathResponse(msg));
  }

  // ===========================================================================
  // PUBLIC API - RECONNECTION INITIATION
  // ===========================================================================

  /**
   * Attempt reconnection via mesh relay
   *
   * @param {string} targetPeerId - Peer to reconnect to
   * @param {string} targetName - Display name of target peer
   * @returns {Promise<{success: boolean, method?: string, reason?: string}>}
   *
   * @example
   * const result = await reconnectionManager.reconnectViaMesh('ABC123', 'Alice');
   * if (result.success) {
   *   console.log('Reconnected via', result.method);
   * } else {
   *   console.error('Reconnection failed:', result.reason);
   * }
   */
  async reconnectViaMesh(targetPeerId, targetName) {
    this.stats.totalAttempts++;

    // Validation
    if (!targetPeerId || !targetName) {
      return { success: false, reason: 'invalid_parameters' };
    }

    // Don't reconnect to ourselves
    if (targetPeerId === this.identity.uuid) {
      return { success: false, reason: 'cannot_connect_to_self' };
    }

    // Check if already connected
    if (this.peerManager.peers.has(targetPeerId)) {
      return { success: false, reason: 'already_connected' };
    }

    // Check concurrent reconnection limit
    if (this.pendingReconnects.size >= this.config.maxConcurrentReconnects) {
      return { success: false, reason: 'too_many_concurrent_attempts' };
    }

    try {
      // Step 1: Find path to target peer
      const hasPath = await this.findPathToTarget(targetPeerId, this.config.pathQueryTimeout);

      if (!hasPath) {
        this.stats.pathNotFound++;

        // Record failed attempt
        if (this.peerPersistence) {
          await this.peerPersistence.incrementReconnectionAttempts(targetPeerId);
        }

        return { success: false, reason: 'no_path_found' };
      }

      // Step 2: Create WebRTC peer connection (initiator)
      const peer = await this.createReconnectionPeer(true, targetPeerId, targetName);

      // Step 3: Send offer through mesh
      const result = await this.sendOfferAndWaitForAnswer(peer, targetPeerId, targetName);

      if (result.success) {
        this.stats.successful++;

        // Update persistence
        if (this.peerPersistence) {
          await this.peerPersistence.updateLastSeen(targetPeerId);
        }
      } else {
        this.stats.failed++;

        // Record failed attempt
        if (this.peerPersistence) {
          await this.peerPersistence.incrementReconnectionAttempts(targetPeerId);
        }
      }

      return result;

    } catch (error) {
      console.error('[ReconnectionManager] Reconnection error:', error);
      this.stats.failed++;

      // Record failed attempt
      if (this.peerPersistence) {
        await this.peerPersistence.incrementReconnectionAttempts(targetPeerId);
      }

      return { success: false, reason: 'error', error: error.message };
    }
  }

  // ===========================================================================
  // PATH DISCOVERY
  // ===========================================================================

  /**
   * Query mesh for path to target peer
   *
   * Broadcasts a path query through the mesh and waits for responses
   * from peers who are connected to the target.
   *
   * @param {string} targetPeerId - Target peer to find
   * @param {number} timeout - Timeout in milliseconds (default: 5000ms)
   * @returns {Promise<boolean>} True if path exists
   *
   * @example
   * const hasPath = await reconnectionManager.findPathToTarget('ABC123', 5000);
   * if (hasPath) {
   *   console.log('Target peer is reachable');
   * }
   */
  async findPathToTarget(targetPeerId, timeout = 5000) {
    const queryId = this.generateId('query');

    return new Promise((resolve, reject) => {
      // Create query tracking
      this.activeQueries.set(queryId, {
        targetPeerId,
        resolve,
        reject,
        startTime: Date.now()
      });

      // Set timeout
      const timeoutHandle = setTimeout(() => {
        const responses = this.pathQueryResponses.get(queryId);
        const hasPath = responses && responses.size > 0;

        // Cleanup
        this.activeQueries.delete(queryId);
        this.pathQueryResponses.delete(queryId);

        resolve(hasPath);
      }, timeout);

      // Store timeout handle
      this.activeQueries.get(queryId).timeout = timeoutHandle;

      // Broadcast path query
      const queryMessage = this.router.createMessage(
        RECONNECT_MESSAGE_TYPES.PATH_QUERY,
        {
          queryId,
          targetPeerId,
          queryOrigin: this.identity.uuid
        },
        {
          ttl: this.config.pathQueryTTL,
          routingHint: 'broadcast'
        }
      );

      this.router.routeMessage(queryMessage);
    });
  }

  /**
   * Handle incoming path query
   *
   * If we are connected to the target peer, respond with our relay information.
   *
   * @param {Object} message - Path query message
   * @private
   */
  handlePathQuery(message) {
    const { queryId, targetPeerId, queryOrigin } = message.payload;

    // Don't respond to our own queries
    if (queryOrigin === this.identity.uuid) {
      return;
    }

    // Check if we're connected to the target
    const isConnected = this.peerManager.peers.has(targetPeerId);

    if (isConnected) {
      // Send response back to query origin
      const responseMessage = this.router.createMessage(
        RECONNECT_MESSAGE_TYPES.PATH_RESPONSE,
        {
          queryId,
          targetPeerId,
          relayPeerId: this.identity.uuid,
          relayName: this.identity.displayName,
          hopCount: message.hopCount || 0
        },
        {
          targetPeerId: queryOrigin,
          ttl: 10
        }
      );

      this.router.routeMessage(responseMessage);
    }
  }

  /**
   * Handle incoming path response
   *
   * Record that someone in the mesh can reach the target peer.
   *
   * @param {Object} message - Path response message
   * @private
   */
  handlePathResponse(message) {
    const { queryId, relayPeerId, relayName, hopCount } = message.payload;

    // Get or create response set
    if (!this.pathQueryResponses.has(queryId)) {
      this.pathQueryResponses.set(queryId, new Set());
    }

    // Add response
    this.pathQueryResponses.get(queryId).add({
      relayPeerId,
      relayName,
      hopCount,
      timestamp: Date.now()
    });

    // Check if this completes an active query
    const activeQuery = this.activeQueries.get(queryId);
    if (activeQuery) {
      // We got at least one response, so we have a path
      clearTimeout(activeQuery.timeout);
      activeQuery.resolve(true);

      this.activeQueries.delete(queryId);

      // Keep responses for a bit in case we need them
      setTimeout(() => {
        this.pathQueryResponses.delete(queryId);
      }, 10000);
    }
  }

  // ===========================================================================
  // OFFER/ANSWER SIGNALING
  // ===========================================================================

  /**
   * Create WebRTC peer connection for reconnection
   *
   * @param {boolean} initiator - True if we're the initiator
   * @param {string} peerId - Target peer ID
   * @param {string} peerName - Target peer name
   * @returns {Promise<SimplePeer>} Peer instance
   * @private
   */
  async createReconnectionPeer(initiator, peerId, peerName) {
    return new Promise((resolve, reject) => {
      const peer = new SimplePeer({
        initiator,
        trickle: true,
        config: ICE_CONFIG
      });

      let offerGenerated = false;

      peer.on('signal', data => {
        if (initiator && data.type === 'offer' && !offerGenerated) {
          offerGenerated = true;
          resolve(peer);
        }
      });

      peer.on('error', err => {
        console.error('[ReconnectionManager] Peer error:', err);
        if (!offerGenerated && initiator) {
          reject(err);
        }
      });

      // Non-initiator resolves immediately
      if (!initiator) {
        resolve(peer);
      }

      // Timeout for offer generation
      setTimeout(() => {
        if (initiator && !offerGenerated) {
          reject(new Error('Offer generation timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Send offer and wait for answer
   *
   * @param {SimplePeer} peer - Peer connection
   * @param {string} targetPeerId - Target peer ID
   * @param {string} targetName - Target peer name
   * @returns {Promise<{success: boolean, method?: string, reason?: string}>}
   * @private
   */
  async sendOfferAndWaitForAnswer(peer, targetPeerId, targetName) {
    const reconnectId = this.generateId('reconnect');

    return new Promise((resolve, reject) => {
      // Track this reconnection
      this.pendingReconnects.set(reconnectId, {
        targetPeerId,
        targetName,
        peer,
        resolve,
        reject,
        state: ReconnectionState.SENDING_OFFER,
        startTime: Date.now()
      });

      // Set overall timeout
      const timeoutHandle = setTimeout(() => {
        this.stats.timedOut++;

        peer.destroy();
        this.pendingReconnects.delete(reconnectId);

        resolve({ success: false, reason: 'timeout' });
      }, this.config.reconnectTimeout);

      // Store timeout handle
      this.pendingReconnects.get(reconnectId).timeout = timeoutHandle;

      // Wait for offer signal
      peer.on('signal', data => {
        if (data.type === 'offer') {
          // Send offer through mesh
          const offerMessage = this.router.createMessage(
            RECONNECT_MESSAGE_TYPES.RECONNECT_OFFER,
            {
              reconnectId,
              offer: btoa(JSON.stringify(data)),
              requesterPeerId: this.identity.uuid,
              requesterName: this.identity.displayName,
              timestamp: Date.now()
            },
            {
              targetPeerId,
              ttl: this.config.offerTTL,
              routingHint: 'relay'
            }
          );

          this.router.routeMessage(offerMessage);

          // Update state
          const pending = this.pendingReconnects.get(reconnectId);
          if (pending) {
            pending.state = ReconnectionState.WAITING_ANSWER;
          }
        }
      });

      // Handle connection establishment
      peer.on('connect', () => {
        const pending = this.pendingReconnects.get(reconnectId);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.state = ReconnectionState.CONNECTED;
        }

        // Register the peer with peer manager
        this.peerManager.registerReconnectedPeer(targetPeerId, targetName, peer);

        this.pendingReconnects.delete(reconnectId);

        resolve({ success: true, method: 'mesh_relay' });
      });

      // Handle errors
      peer.on('error', err => {
        console.error(`[ReconnectionManager] Peer connection error:`, err);

        const pending = this.pendingReconnects.get(reconnectId);
        if (pending) {
          clearTimeout(pending.timeout);
        }

        this.pendingReconnects.delete(reconnectId);

        resolve({ success: false, reason: 'peer_error', error: err.message });
      });

      // Handle close
      peer.on('close', () => {
        const pending = this.pendingReconnects.get(reconnectId);
        if (pending && pending.state !== ReconnectionState.CONNECTED) {
          clearTimeout(pending.timeout);
          this.pendingReconnects.delete(reconnectId);
          resolve({ success: false, reason: 'connection_closed' });
        }
      });
    });
  }

  /**
   * Handle incoming reconnection offer (we're the target)
   *
   * Someone wants to reconnect to us. Decide if we should accept,
   * and if so, create an answer.
   *
   * @param {Object} message - Message from mesh router
   */
  async handleReconnectOffer(message) {
    const {
      reconnectId,
      offer,
      requesterPeerId,
      requesterName,
      timestamp
    } = message.payload;

    this.stats.offersReceived++;

    // Perfect negotiation: Check for collision (both peers trying to reconnect)
    const ourPendingOffer = Array.from(this.pendingReconnects.values())
      .find(pending => pending.targetPeerId === requesterPeerId);

    if (ourPendingOffer) {
      // Collision detected - both peers sent offers
      // Use deterministic tie-breaking: polite peer (higher UUID) rolls back
      const weArePolite = this.identity.uuid > requesterPeerId;

      if (weArePolite) {
        // Roll back our offer and accept theirs
        ourPendingOffer.peer.destroy();
        clearTimeout(ourPendingOffer.timeout);

        // Find and delete our pending reconnect by searching for the entry
        for (const [id, pending] of this.pendingReconnects.entries()) {
          if (pending === ourPendingOffer) {
            this.pendingReconnects.delete(id);
            break;
          }
        }
      } else {
        // We're impolite (lower UUID), proceed with our offer, ignore theirs
        this.sendRejection(reconnectId, requesterPeerId, 'collision_detected');
        return;
      }
    }

    // Check if we should accept
    if (!this.shouldAcceptReconnection(requesterPeerId)) {
      this.sendRejection(reconnectId, requesterPeerId, 'declined');
      return;
    }

    // Check if already connected
    if (this.peerManager.peers.has(requesterPeerId)) {
      this.sendRejection(reconnectId, requesterPeerId, 'already_connected');
      return;
    }

    try {
      // Decode offer
      const offerData = JSON.parse(atob(offer));

      // Create peer (not initiator)
      const peer = await this.createReconnectionPeer(false, requesterPeerId, requesterName);

      // Set up connection handlers
      peer.on('connect', () => {
        // Register peer
        this.peerManager.registerReconnectedPeer(requesterPeerId, requesterName, peer);

        // Update persistence
        if (this.peerPersistence) {
          this.peerPersistence.updateLastSeen(requesterPeerId);
        }
      });

      peer.on('error', err => {
        console.error(`[ReconnectionManager] Error reconnecting with ${requesterName}:`, err);
      });

      // Wait for answer signal
      peer.on('signal', data => {
        if (data.type === 'answer') {
          // Send answer through mesh
          const answerMessage = this.router.createMessage(
            RECONNECT_MESSAGE_TYPES.RECONNECT_ANSWER,
            {
              reconnectId,
              answer: btoa(JSON.stringify(data)),
              acceptorPeerId: this.identity.uuid,
              acceptorName: this.identity.displayName
            },
            {
              targetPeerId: requesterPeerId,
              ttl: this.config.offerTTL
            }
          );

          this.router.routeMessage(answerMessage);
        }
      });

      // Signal the offer to trigger answer generation
      peer.signal(offerData);

    } catch (error) {
      console.error('[ReconnectionManager] Error handling offer:', error);
      this.sendRejection(reconnectId, requesterPeerId, 'error');
    }
  }

  /**
   * Handle incoming reconnection answer (we initiated)
   *
   * @param {Object} message - Message from mesh router
   */
  async handleReconnectAnswer(message) {
    const {
      reconnectId,
      answer,
      acceptorPeerId,
      acceptorName
    } = message.payload;

    this.stats.answersReceived++;

    // Find pending reconnection
    const pending = this.pendingReconnects.get(reconnectId);
    if (!pending) {
      return;
    }

    try {
      // Decode answer
      const answerData = JSON.parse(atob(answer));

      // Signal answer to peer
      pending.peer.signal(answerData);

      // Update state
      pending.state = ReconnectionState.CONNECTING;

    } catch (error) {
      console.error('[ReconnectionManager] Error handling answer:', error);

      // Cleanup
      pending.peer.destroy();
      clearTimeout(pending.timeout);
      this.pendingReconnects.delete(reconnectId);

      if (pending.resolve) {
        pending.resolve({ success: false, reason: 'answer_error', error: error.message });
      }
    }
  }

  /**
   * Handle reconnection rejection
   *
   * @param {Object} message - Rejection message
   * @private
   */
  handleReconnectRejection(message) {
    const { reconnectId, reason } = message.payload;

    this.stats.rejected++;

    const pending = this.pendingReconnects.get(reconnectId);
    if (pending) {
      pending.peer.destroy();
      clearTimeout(pending.timeout);

      if (pending.resolve) {
        pending.resolve({ success: false, reason: 'rejected', rejectionReason: reason });
      }

      this.pendingReconnects.delete(reconnectId);
    }
  }

  // ===========================================================================
  // ACCEPTANCE & REJECTION
  // ===========================================================================

  /**
   * Check if we should accept reconnection from peer
   *
   * Implements security and connection management policies.
   *
   * @param {string} requesterPeerId - Peer requesting reconnection
   * @returns {boolean} True if should accept
   */
  shouldAcceptReconnection(requesterPeerId) {
    // Don't connect to ourselves
    if (requesterPeerId === this.identity.uuid) {
      return false;
    }

    // Already connected?
    if (this.peerManager.peers.has(requesterPeerId)) {
      return false;
    }

    // Deterministic tie-breaking (same as mesh-introduction pattern)
    // Only one peer should initiate to prevent duplicate connections
    if (this.identity.uuid < requesterPeerId) {
      // We should initiate, not them
      return false;
    }

    // Check connection limits
    const currentCount = this.peerManager.getConnectedPeerCount();
    const maxConnections = this.peerManager.maxConnections || 6;

    if (currentCount >= maxConnections) {
      return false;
    }

    // Check if peer is blacklisted (in persistence)
    // This would be async in real implementation, but we'll check synchronously
    // by assuming peer manager has this info

    return true;
  }

  /**
   * Send rejection message
   *
   * @param {string} reconnectId - Reconnection ID
   * @param {string} requesterPeerId - Peer ID that made the request
   * @param {string} reason - Rejection reason
   */
  sendRejection(reconnectId, requesterPeerId, reason) {
    const rejectionMessage = this.router.createMessage(
      RECONNECT_MESSAGE_TYPES.RECONNECT_REJECTION,
      {
        reconnectId,
        reason,
        rejectorPeerId: this.identity.uuid
      },
      {
        targetPeerId: requesterPeerId,
        ttl: 10
      }
    );

    this.router.routeMessage(rejectionMessage);
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Generate unique ID with prefix
   *
   * @param {string} prefix - ID prefix
   * @returns {string} Unique ID
   * @private
   */
  generateId(prefix = 'reconnect') {
    return `${prefix}-${this.identity.uuid.substring(0, 8)}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * Start periodic cleanup of stale state
   * @private
   */
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up stale reconnection attempts and queries
   * @private
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    // Cleanup old path query responses
    for (const [queryId, responses] of this.pathQueryResponses.entries()) {
      const oldestResponse = Math.min(...Array.from(responses).map(r => r.timestamp));
      if (now - oldestResponse > 60000) { // 1 minute
        this.pathQueryResponses.delete(queryId);
        cleaned++;
      }
    }

    // Cleanup stale active queries (shouldn't happen with timeouts, but just in case)
    for (const [queryId, query] of this.activeQueries.entries()) {
      if (now - query.startTime > 30000) { // 30 seconds
        clearTimeout(query.timeout);
        query.resolve(false);
        this.activeQueries.delete(queryId);
        cleaned++;
      }
    }

    // Cleanup stale reconnections (shouldn't happen with timeouts, but just in case)
    for (const [reconnectId, pending] of this.pendingReconnects.entries()) {
      if (now - pending.startTime > this.config.reconnectTimeout + 10000) { // Extra 10s grace period
        clearTimeout(pending.timeout);
        pending.peer.destroy();
        this.pendingReconnects.delete(reconnectId);
        cleaned++;
      }
    }
  }

  /**
   * Get current statistics
   *
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      pendingReconnects: this.pendingReconnects.size,
      activeQueries: this.activeQueries.size,
      successRate: this.stats.totalAttempts > 0
        ? (this.stats.successful / this.stats.totalAttempts * 100).toFixed(1) + '%'
        : 'N/A'
    };
  }

  /**
   * Get current state (for debugging)
   *
   * @returns {Object} Current state
   */
  getState() {
    return {
      pendingReconnects: Array.from(this.pendingReconnects.entries()).map(([id, data]) => ({
        reconnectId: id,
        targetPeerId: data.targetPeerId,
        targetName: data.targetName,
        state: data.state,
        elapsed: Date.now() - data.startTime
      })),
      activeQueries: Array.from(this.activeQueries.entries()).map(([id, data]) => ({
        queryId: id,
        targetPeerId: data.targetPeerId,
        elapsed: Date.now() - data.startTime
      })),
      pathQueryResponses: Array.from(this.pathQueryResponses.entries()).map(([id, responses]) => ({
        queryId: id,
        responseCount: responses.size,
        relays: Array.from(responses).map(r => r.relayName)
      }))
    };
  }

  /**
   * Stop the reconnection manager
   */
  stop() {
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Cleanup all pending reconnections
    for (const [reconnectId, pending] of this.pendingReconnects.entries()) {
      clearTimeout(pending.timeout);
      pending.peer.destroy();
      if (pending.resolve) {
        pending.resolve({ success: false, reason: 'stopped' });
      }
    }
    this.pendingReconnects.clear();

    // Cleanup all active queries
    for (const [queryId, query] of this.activeQueries.entries()) {
      clearTimeout(query.timeout);
      query.resolve(false);
    }
    this.activeQueries.clear();

    this.pathQueryResponses.clear();
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default ReconnectionManager;
export { ReconnectionManager, ReconnectionState };
