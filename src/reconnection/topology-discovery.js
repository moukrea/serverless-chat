/**
 * Mesh Topology Manager
 *
 * Discovers and maps the mesh network topology for intelligent relay selection
 * and path finding. Uses flood routing to query peers about their connections,
 * building a complete view of "who's connected to whom".
 *
 * Features:
 * - Topology discovery via broadcast queries
 * - BFS path finding for multi-hop routing
 * - Intelligent relay selection with quality scoring
 * - Periodic topology updates
 * - Role determination (hub/relay/leaf/isolated)
 * - Stale data cleanup
 *
 * Integration:
 * - Works with MessageRouter for flood routing
 * - Uses PeerManager for connection information
 * - Provides data for reconnection strategies
 *
 * Complexity Analysis:
 * - Topology discovery: O(N) where N = number of peers
 * - BFS path finding: O(V + E) where V = nodes, E = edges
 * - Relay quality scoring: O(N)
 * - Storage: O(N * M) where M = avg connections per peer
 *
 * @module MeshTopologyManager
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * @typedef {Object} TopologyData
 * @property {string} displayName - Peer's display name
 * @property {Set<string>} connectedTo - Set of peer IDs this peer is connected to
 * @property {Array<Object>} peers - Detailed peer connection info
 * @property {Object} metadata - Additional topology metadata
 * @property {number} lastUpdated - Timestamp of last update
 */

/**
 * @typedef {Object} PeerConnectionInfo
 * @property {string} peerId - Peer ID
 * @property {string} displayName - Display name
 * @property {number} latency - Connection latency in ms
 * @property {number} uptime - Connection uptime in seconds
 * @property {number} connectionQuality - Quality score 0-100
 */

/**
 * @typedef {Object} PathInfo
 * @property {Array<string>} path - Array of peer IDs forming the path
 * @property {number} hopCount - Number of hops in path
 * @property {number} estimatedLatency - Estimated total latency
 */

/**
 * @typedef {Object} RelayCandidate
 * @property {string} peerId - Relay peer ID
 * @property {string} displayName - Display name
 * @property {number} hopCount - Hops to target via this relay
 * @property {number} quality - Relay quality score 0-100
 */

// =============================================================================
// MESSAGE TYPE CONSTANTS
// =============================================================================

const MESSAGE_TYPES = {
  TOPOLOGY_REQUEST: 'topology_request',
  TOPOLOGY_RESPONSE: 'topology_response',
};

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG = {
  discoveryTimeout: 10000,          // 10 seconds for topology discovery
  discoveryInterval: 60000,         // 1 minute between automatic discoveries
  topologyStaleTime: 300000,        // 5 minutes before data considered stale
  maxPaths: 3,                      // Maximum paths to find in BFS
  cleanupInterval: 120000,          // 2 minutes between cleanup runs
  requestTTL: 5,                    // TTL for topology request messages
  responseTTL: 5,                   // TTL for topology response messages
};

// =============================================================================
// MESH TOPOLOGY MANAGER
// =============================================================================

class MeshTopologyManager {
  /**
   * Create a MeshTopologyManager
   * @param {Object} identity - User identity {uuid, displayName}
   * @param {MessageRouter} router - Message router instance
   * @param {Object} peerManager - Peer manager instance
   * @param {Object} config - Configuration options
   */
  constructor(identity, router, peerManager, config = {}) {
    this.identity = identity;
    this.router = router;
    this.peerManager = peerManager;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Topology map: peerId -> TopologyData
    this.topology = new Map();

    // Active discovery tracking
    this.activeRequests = new Map(); // requestId -> {resolve, reject, timer, responses}

    // Statistics
    this.stats = {
      requestsSent: 0,
      responsesReceived: 0,
      topologyUpdates: 0,
      lastDiscoveryTime: null,
      discoveryInterval: this.config.discoveryInterval,
    };

    // Timers
    this.discoveryTimer = null;
    this.cleanupTimer = null;

    // Initialize
    this.initialize();
  }

  /**
   * Initialize topology manager
   */
  initialize() {
    // Register message handlers
    this.router.on(MESSAGE_TYPES.TOPOLOGY_REQUEST,
      (msg) => this.handleTopologyRequest(msg));
    this.router.on(MESSAGE_TYPES.TOPOLOGY_RESPONSE,
      (msg) => this.handleTopologyResponse(msg));

    // Start periodic cleanup
    this.startCleanup();

    console.log('[Topology] Manager initialized');
  }

  // ===========================================================================
  // TOPOLOGY DISCOVERY
  // ===========================================================================

  /**
   * Request topology information from mesh
   * Broadcasts a request and waits for responses from all reachable peers
   *
   * @param {number} timeout - Wait time for responses (default 10000ms)
   * @returns {Promise<Object>} Complete topology view
   */
  async discoverTopology(timeout = this.config.discoveryTimeout) {
    const requestId = this.generateRequestId();

    console.log(`[Topology] Starting discovery (request: ${requestId.substring(0, 8)})`);
    this.stats.requestsSent++;
    this.stats.lastDiscoveryTime = Date.now();

    // Create promise for collection of responses
    const promise = new Promise((resolve, reject) => {
      const responses = new Map();

      // Set timeout
      const timer = setTimeout(() => {
        this.activeRequests.delete(requestId);
        console.log(`[Topology] Discovery complete: ${responses.size} responses`);
        resolve(responses);
      }, timeout);

      // Store request data
      this.activeRequests.set(requestId, {
        resolve,
        reject,
        timer,
        responses,
        startTime: Date.now(),
      });
    });

    // Broadcast topology request
    const message = this.router.createMessage(
      MESSAGE_TYPES.TOPOLOGY_REQUEST,
      {
        requestId,
        requesterId: this.identity.uuid,
        timestamp: Date.now(),
      },
      {
        ttl: this.config.requestTTL,
        routingHint: 'broadcast',
      }
    );

    await this.router.routeMessage(message);

    // Wait for responses
    const responses = await promise;

    // Update topology map
    this.updateTopologyMap(responses);
    this.stats.topologyUpdates++;

    return this.getTopologyView();
  }

  /**
   * Handle topology request from peer
   * Responds with our local connection information
   *
   * @param {Object} message - TOPOLOGY_REQUEST message
   */
  async handleTopologyRequest(message) {
    const { requestId, requesterId } = message.payload;

    console.log(`[Topology] Received request from ${message.senderName} (${requesterId.substring(0, 8)})`);

    // Don't respond to our own requests
    if (requesterId === this.identity.uuid) {
      return;
    }

    // Build connection information
    const connectedPeers = [];

    for (const [peerId, peerData] of this.peerManager.peers.entries()) {
      // Skip temporary peers and non-connected
      if (peerId === '_temp' || peerData.status !== 'connected') {
        continue;
      }

      // Get connection stats
      const stats = peerData.peer?.connectionState || {};
      const latency = stats.latency || null;
      const uptime = stats.uptime || 0;

      connectedPeers.push({
        peerId,
        displayName: peerData.displayName || 'Unknown',
        latency,
        uptime,
        connectionQuality: this.calculateConnectionQuality(peerData),
      });
    }

    // Create response message
    const response = this.router.createMessage(
      MESSAGE_TYPES.TOPOLOGY_RESPONSE,
      {
        requestId,
        responderId: this.identity.uuid,
        responderName: this.identity.displayName,
        timestamp: Date.now(),
        connectedPeers,
        metadata: {
          totalConnections: connectedPeers.length,
          meshRole: this.determineRole(),
        },
      },
      {
        targetPeerId: requesterId,  // Send back to requester
        ttl: this.config.responseTTL,
      }
    );

    await this.router.routeMessage(response);

    console.log(`[Topology] Sent response with ${connectedPeers.length} connections`);
  }

  /**
   * Handle topology response from peer
   * Stores response in active request if applicable
   *
   * @param {Object} message - TOPOLOGY_RESPONSE message
   */
  async handleTopologyResponse(message) {
    const { requestId, responderId, responderName, connectedPeers, metadata } = message.payload;

    this.stats.responsesReceived++;

    // Check if this is for an active request
    const request = this.activeRequests.get(requestId);
    if (!request) {
      // Not our request or already timed out
      return;
    }

    console.log(`[Topology] Received response from ${responderName} (${connectedPeers.length} connections)`);

    // Store response
    request.responses.set(responderId, {
      peerId: responderId,
      displayName: responderName,
      connectedPeers,
      metadata,
      timestamp: message.timestamp,
    });
  }

  /**
   * Update topology map with discovery responses
   * Processes responses and builds connectivity graph
   *
   * @param {Map} responses - Map of peer responses
   */
  updateTopologyMap(responses) {
    const now = Date.now();

    for (const [peerId, data] of responses) {
      const connectedTo = new Set();

      // Extract peer IDs from connected peers list
      if (data.connectedPeers && Array.isArray(data.connectedPeers)) {
        for (const conn of data.connectedPeers) {
          connectedTo.add(conn.peerId);
        }
      }

      // Store topology data
      this.topology.set(peerId, {
        displayName: data.displayName,
        connectedTo,
        peers: data.connectedPeers || [],
        metadata: data.metadata || {},
        lastUpdated: now,
      });
    }

    console.log(`[Topology] Map updated: ${this.topology.size} peers mapped`);
  }

  // ===========================================================================
  // PATH FINDING (BFS ALGORITHM)
  // ===========================================================================

  /**
   * Find paths to target peer through mesh using BFS
   *
   * Algorithm: Breadth-First Search
   * Complexity: O(V + E) where V = nodes, E = edges
   *
   * This finds the shortest paths first, which is optimal for
   * minimizing hop count and latency.
   *
   * @param {string} targetPeerId - Target peer ID
   * @param {number} maxPaths - Maximum paths to find (default 3)
   * @returns {Array<Array<string>>} Array of paths (each path is array of peer IDs)
   */
  findPathsToPeer(targetPeerId, maxPaths = this.config.maxPaths) {
    const paths = [];
    const visited = new Set();

    // BFS queue: {peerId, path}
    const queue = [{ peerId: this.identity.uuid, path: [] }];
    visited.add(this.identity.uuid);

    console.log(`[Topology] Finding paths to ${targetPeerId.substring(0, 8)} (max: ${maxPaths})`);

    while (queue.length > 0 && paths.length < maxPaths) {
      const { peerId, path } = queue.shift();

      // Get connections for this peer
      const peerData = this.topology.get(peerId);

      // If no topology data, check direct connections (for self)
      let connections = [];
      if (peerId === this.identity.uuid) {
        // Use our direct connections
        connections = Array.from(this.peerManager.peers.keys())
          .filter(id => id !== '_temp' && this.peerManager.peers.get(id).status === 'connected');
      } else if (peerData) {
        // Use topology data for other peers
        connections = Array.from(peerData.connectedTo);
      } else {
        // No data available for this peer
        continue;
      }

      // Explore connections
      for (const nextPeer of connections) {
        if (nextPeer === targetPeerId) {
          // Found a path!
          const completePath = [...path, peerId, targetPeerId];
          paths.push(completePath);
          console.log(`[Topology] Found path (${completePath.length - 1} hops): ${completePath.map(id => id.substring(0, 8)).join(' -> ')}`);

          // Don't explore further from this branch
          continue;
        }

        if (!visited.has(nextPeer)) {
          visited.add(nextPeer);
          queue.push({
            peerId: nextPeer,
            path: [...path, peerId]
          });
        }
      }
    }

    if (paths.length === 0) {
      console.log(`[Topology] No paths found to ${targetPeerId.substring(0, 8)}`);
    }

    return paths;
  }

  // ===========================================================================
  // RELAY SELECTION
  // ===========================================================================

  /**
   * Find peers that can relay to target
   * Returns peers with direct connection to target, sorted by quality
   *
   * @param {string} targetPeerId - Target peer ID
   * @returns {Array<RelayCandidate>} Array of relay candidates
   */
  findPotentialRelays(targetPeerId) {
    const relays = [];

    console.log(`[Topology] Finding relays for ${targetPeerId.substring(0, 8)}`);

    // Check topology map for peers connected to target
    for (const [peerId, data] of this.topology.entries()) {
      if (data.connectedTo.has(targetPeerId)) {
        const quality = this.calculateRelayQuality(data);

        relays.push({
          peerId,
          displayName: data.displayName,
          hopCount: 1, // Direct connection to target
          quality,
        });

        console.log(`[Topology] Found relay: ${data.displayName} (quality: ${quality})`);
      }
    }

    // Check our direct connections (in case topology is incomplete)
    for (const [peerId, peerData] of this.peerManager.peers.entries()) {
      if (peerId === '_temp' || peerData.status !== 'connected') continue;
      if (relays.some(r => r.peerId === peerId)) continue; // Already added

      // Check if this peer is connected to target
      const topologyData = this.topology.get(peerId);
      if (topologyData && topologyData.connectedTo.has(targetPeerId)) {
        relays.push({
          peerId,
          displayName: peerData.displayName || 'Unknown',
          hopCount: 1,
          quality: this.calculateRelayQuality(topologyData),
        });
      }
    }

    // Sort by quality (best first)
    relays.sort((a, b) => b.quality - a.quality);

    console.log(`[Topology] Found ${relays.length} potential relays`);

    return relays;
  }

  /**
   * Get best relay for reaching target
   * Returns the highest quality relay, or null if none available
   *
   * @param {string} targetPeerId - Target peer ID
   * @returns {string|null} Best relay peer ID or null
   */
  getBestRelayForTarget(targetPeerId) {
    const relays = this.findPotentialRelays(targetPeerId);

    if (relays.length === 0) {
      console.log(`[Topology] No relay available for ${targetPeerId.substring(0, 8)}`);
      return null;
    }

    const best = relays[0];
    console.log(`[Topology] Best relay: ${best.displayName} (quality: ${best.quality})`);

    return best.peerId;
  }

  /**
   * Calculate relay quality score (0-100)
   *
   * Factors:
   * - Number of connections (more = better hub)
   * - Data recency (fresher = more reliable)
   * - Average peer connection quality
   *
   * @param {TopologyData} peerData - Peer's topology data
   * @returns {number} Quality score 0-100
   */
  calculateRelayQuality(peerData) {
    let score = 50; // Base score

    // More connections = better hub (up to 30 points)
    const connectionBonus = Math.min(peerData.connectedTo.size * 5, 30);
    score += connectionBonus;

    // Recent update = more reliable (up to 20 points)
    const age = Date.now() - peerData.lastUpdated;
    if (age < 60000) {
      // < 1 minute: very fresh
      score += 20;
    } else if (age < 300000) {
      // < 5 minutes: reasonably fresh
      score += 10;
    }
    // Older data gets no bonus

    // Average peer quality (up to 20 points)
    if (peerData.peers && peerData.peers.length > 0) {
      const avgQuality = peerData.peers.reduce(
        (sum, p) => sum + (p.connectionQuality || 0),
        0
      ) / peerData.peers.length;
      score += avgQuality * 0.2; // Scale to 20 points
    }

    // Ensure score is in valid range
    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * Calculate connection quality for a peer (0-100)
   * Used when reporting our connections to others
   *
   * @param {Object} peerData - Peer data from PeerManager
   * @returns {number} Quality score 0-100
   */
  calculateConnectionQuality(peerData) {
    let score = 50; // Base score

    const peer = peerData.peer;
    if (!peer) return score;

    // Connection state
    if (peer.connectionState) {
      const state = peer.connectionState;

      // Latency bonus (up to 30 points)
      if (state.latency !== null && state.latency !== undefined) {
        if (state.latency < 50) score += 30;
        else if (state.latency < 100) score += 25;
        else if (state.latency < 200) score += 15;
        else if (state.latency < 500) score += 5;
      }

      // Uptime bonus (up to 20 points)
      if (state.uptime !== undefined) {
        if (state.uptime > 600) score += 20;      // 10+ minutes
        else if (state.uptime > 300) score += 15; // 5+ minutes
        else if (state.uptime > 60) score += 10;  // 1+ minute
        else if (state.uptime > 10) score += 5;   // 10+ seconds
      }
    }

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  // ===========================================================================
  // TOPOLOGY VIEW
  // ===========================================================================

  /**
   * Get current topology view
   * Provides a complete snapshot of known mesh topology
   *
   * @returns {Object} Topology view with nodes, edges, and metadata
   */
  getTopologyView() {
    const view = {
      self: {
        peerId: this.identity.uuid,
        displayName: this.identity.displayName,
        connections: Array.from(this.peerManager.peers.keys())
          .filter(id => id !== '_temp' && this.peerManager.peers.get(id).status === 'connected'),
        role: this.determineRole(),
      },
      knownPeers: [],
      totalNodes: 1, // Starts with self
      totalEdges: 0,
    };

    const seenPeers = new Set([this.identity.uuid]);

    // Build peer list from topology
    for (const [peerId, data] of this.topology.entries()) {
      if (!seenPeers.has(peerId)) {
        view.totalNodes++;
        seenPeers.add(peerId);
      }

      view.knownPeers.push({
        peerId,
        displayName: data.displayName,
        connections: Array.from(data.connectedTo),
        connectionCount: data.connectedTo.size,
        role: this.calculateRole(data.connectedTo.size),
        lastUpdated: data.lastUpdated,
        age: Date.now() - data.lastUpdated,
      });

      view.totalEdges += data.connectedTo.size;
    }

    // Account for bidirectional edges (each edge counted twice)
    view.totalEdges = Math.floor(view.totalEdges / 2);

    // Add our edges
    view.totalEdges += view.self.connections.length;

    return view;
  }

  // ===========================================================================
  // ROLE DETERMINATION
  // ===========================================================================

  /**
   * Determine our role in mesh
   * Based on number of current connections
   *
   * @returns {string} Role: 'hub', 'relay', 'leaf', or 'isolated'
   */
  determineRole() {
    const connectionCount = this.getConnectedPeerCount();
    return this.calculateRole(connectionCount);
  }

  /**
   * Calculate role based on connection count
   *
   * @param {number} connectionCount - Number of connections
   * @returns {string} Role classification
   */
  calculateRole(connectionCount) {
    if (connectionCount >= 5) return 'hub';      // Well-connected hub
    if (connectionCount >= 3) return 'relay';    // Medium connectivity
    if (connectionCount >= 1) return 'leaf';     // Edge node
    return 'isolated';                            // No connections
  }

  /**
   * Get count of connected peers
   *
   * @returns {number} Number of connected peers
   */
  getConnectedPeerCount() {
    let count = 0;
    for (const [peerId, peerData] of this.peerManager.peers.entries()) {
      if (peerId !== '_temp' && peerData.status === 'connected') {
        count++;
      }
    }
    return count;
  }

  // ===========================================================================
  // PERIODIC DISCOVERY
  // ===========================================================================

  /**
   * Start periodic topology discovery
   * Automatically discovers topology at regular intervals
   *
   * @param {number} interval - Interval in ms (default 60000 = 1 minute)
   */
  startTopologyDiscovery(interval = this.config.discoveryInterval) {
    // Stop existing timer
    this.stopTopologyDiscovery();

    this.stats.discoveryInterval = interval;

    console.log(`[Topology] Starting periodic discovery (interval: ${interval}ms)`);

    this.discoveryTimer = setInterval(async () => {
      // Only discover if we have connections
      if (this.getConnectedPeerCount() > 0) {
        try {
          await this.discoverTopology(5000); // Shorter timeout for background discovery
        } catch (error) {
          console.error('[Topology] Periodic discovery failed:', error);
        }
      } else {
        console.log('[Topology] Skipping discovery (no connections)');
      }
    }, interval);
  }

  /**
   * Stop periodic topology discovery
   */
  stopTopologyDiscovery() {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
      console.log('[Topology] Stopped periodic discovery');
    }
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  /**
   * Start periodic cleanup of stale topology data
   */
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleData();
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up stale topology data
   * Removes data older than configured stale time
   */
  cleanupStaleData() {
    const now = Date.now();
    const staleTime = this.config.topologyStaleTime;
    let removed = 0;

    for (const [peerId, data] of this.topology.entries()) {
      const age = now - data.lastUpdated;
      if (age > staleTime) {
        this.topology.delete(peerId);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[Topology] Cleaned ${removed} stale entries`);
    }
  }

  /**
   * Stop cleanup timer
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get statistics and metrics
   *
   * @returns {Object} Statistics object
   */
  getStats() {
    const view = this.getTopologyView();

    return {
      knownPeers: this.topology.size,
      totalNodes: view.totalNodes,
      totalEdges: view.totalEdges,
      ourRole: this.determineRole(),
      ourConnections: view.self.connections.length,
      requestsSent: this.stats.requestsSent,
      responsesReceived: this.stats.responsesReceived,
      topologyUpdates: this.stats.topologyUpdates,
      lastDiscovery: this.stats.lastDiscoveryTime,
      discoveryInterval: this.stats.discoveryInterval,
      activeRequests: this.activeRequests.size,
    };
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Generate unique request ID
   *
   * @returns {string} Request ID
   */
  generateRequestId() {
    return `topo-${this.identity.uuid.substring(0, 8)}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear all topology data
   */
  clear() {
    this.topology.clear();
    this.activeRequests.clear();
    console.log('[Topology] Cleared all data');
  }

  /**
   * Stop all timers and cleanup
   */
  destroy() {
    this.stopTopologyDiscovery();
    this.stopCleanup();

    // Cancel active requests
    for (const [requestId, request] of this.activeRequests.entries()) {
      clearTimeout(request.timer);
      request.reject(new Error('Topology manager destroyed'));
    }

    this.clear();
    console.log('[Topology] Manager destroyed');
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default MeshTopologyManager;
export { MESSAGE_TYPES, DEFAULT_CONFIG };
