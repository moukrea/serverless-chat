/**
 * Master Reconnection Strategy - The Reconnection Orchestrator
 *
 * This is the "brain" that coordinates all reconnection strategies and provides
 * a unified interface for the entire reconnection system.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │         MasterReconnectionStrategy (this file)              │
 * │                                                               │
 * │  ┌─────────────────────────────────────────────────────┐   │
 * │  │  Decides: Cold Start vs Warm Start                   │   │
 * │  │  Orchestrates: Strategy selection & fallbacks        │   │
 * │  │  Provides: Unified API & comprehensive stats         │   │
 * │  └─────────────────────────────────────────────────────┘   │
 * │                                                               │
 * │  Manages:                                                    │
 * │  ├─ DirectReconnectionManager (fast, 5-20% success)         │
 * │  ├─ ReconnectionManager (mesh relay, 70-80% success)        │
 * │  ├─ MeshAnnouncementManager (gossip announcements)          │
 * │  ├─ ColdStartManager (0 connections recovery)               │
 * │  └─ MeshTopologyManager (optional, topology discovery)      │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Decision Flow:
 * ═══════════════════════════════════════════════════════════════
 *
 * reconnectToMesh() Entry Point
 * │
 * ├─ Check Current Connections
 * │
 * ├─ 0 Connections? → COLD START PATH
 * │  ├─ Try direct to recent peers (< 5 min)
 * │  ├─ Try knock protocol (experimental)
 * │  ├─ Try all known peers (< 24h)
 * │  ├─ Fallback to initial pairing
 * │  └─ On success: Post-reconnection setup
 * │
 * └─ Has Connections? → WARM START PATH
 *    ├─ Announce presence to mesh
 *    ├─ Discover topology (optional)
 *    ├─ Get desired peers from persistence
 *    └─ For each peer:
 *       ├─ Try direct reconnection (8s timeout)
 *       ├─ Try mesh relay (20s timeout)
 *       └─ Move to next peer
 *
 * Cascading Fallback Strategy (per peer):
 * ═══════════════════════════════════════════════════════════════
 * 1. Direct (cached ICE)     →  8s timeout  →  5-20% success
 * 2. Mesh Relay (gossip)     → 20s timeout  → 70-80% success
 *
 * @module reconnection/master-reconnection
 */

import DirectReconnectionManager from './direct-reconnection.js';
import ReconnectionManager from './relay-reconnection.js';
import MeshAnnouncementManager from './mesh-announcements.js';
import ColdStartManager from './cold-start.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

export const MASTER_RECONNECTION_CONFIG = {
  // Strategy timeouts (per peer)
  TIMEOUTS: {
    DIRECT: 8000,           // 8 seconds for direct reconnection
    MESH_RELAY: 20000,      // 20 seconds for mesh relay
    TOTAL_PER_PEER: 30000,  // 30 seconds total per peer
  },

  // Warm start settings
  WARM_START: {
    MAX_PEERS_TO_RECONNECT: 10,         // Maximum peers to attempt reconnection
    PARALLEL_ATTEMPTS: false,            // Sequential (false) or parallel (true)
    EARLY_EXIT_THRESHOLD: null,          // Stop after N connections (null = try all)
    ANNOUNCEMENT_DELAY: 1000,            // Wait 1s before announcing
    TOPOLOGY_DISCOVERY_TIMEOUT: 5000,    // 5s for topology discovery
  },

  // Cold start settings (delegated to ColdStartManager)
  COLD_START: {
    MAX_DURATION: 40000,    // 40 seconds maximum
    AUTO_FALLBACK: true,     // Automatically fallback to pairing UI
  },

  // Post-reconnection
  POST_RECONNECTION: {
    ENABLE_PERIODIC_ANNOUNCEMENTS: true,
    ENABLE_TOPOLOGY_DISCOVERY: true,
    UPDATE_PERSISTENCE: true,
  },

  // Connection limits
  LIMITS: {
    MIN_PEERS_FOR_WARM_START: 1,        // Need at least 1 connection for warm start
    CONNECTION_CHECK_RETRIES: 3,         // Retry connection count check
    CONNECTION_CHECK_DELAY: 500,         // Wait 500ms between retries
  },

  // Statistics
  STATS: {
    TRACK_ATTEMPTS: true,
    TRACK_DURATIONS: true,
    TRACK_SUCCESS_RATES: true,
  },
};

// =============================================================================
// MASTER RECONNECTION STRATEGY CLASS
// =============================================================================

class MasterReconnectionStrategy {
  /**
   * Create Master Reconnection Strategy
   *
   * @param {Object} identity - User identity { uuid/peerId, displayName }
   * @param {Object} router - MessageRouter instance for mesh communication
   * @param {Object} peerManager - PeerManager instance (mesh network)
   * @param {Object} peerPersistence - PeerPersistenceManager instance
   * @param {Object} reconnectionAuth - ReconnectionAuth instance
   * @param {Object} [options={}] - Optional configuration overrides
   *
   * @example
   * const masterReconnect = new MasterReconnectionStrategy(
   *   identity,
   *   router,
   *   peerManager,
   *   peerPersistence,
   *   reconnectionAuth
   * );
   *
   * // Simple usage
   * const result = await masterReconnect.reconnectToMesh();
   * if (result.success) {
   *   console.log(`Connected to ${result.peersConnected} peers via ${result.method}`);
   * }
   */
  constructor(identity, router, peerManager, peerPersistence, reconnectionAuth, options = {}) {
    this.identity = identity;
    this.router = router;
    this.peerManager = peerManager;
    this.peerPersistence = peerPersistence;
    this.reconnectionAuth = reconnectionAuth;

    // Merge configuration
    this.config = {
      ...MASTER_RECONNECTION_CONFIG,
      ...options,
    };

    // Initialize child managers
    this.directReconnect = new DirectReconnectionManager(
      identity,
      peerManager,
      peerPersistence
    );

    this.meshReconnect = new ReconnectionManager(
      identity,
      router,
      peerManager,
      peerPersistence
    );

    this.announcements = new MeshAnnouncementManager(
      identity,
      router,
      peerManager,
      reconnectionAuth,
      peerPersistence
    );

    this.coldStart = new ColdStartManager(
      identity,
      peerManager,
      peerPersistence,
      this.directReconnect,
      this.announcements
    );

    // Optional: MeshTopologyManager (future feature)
    this.topology = null;
    // If topology manager exists, it would be initialized here:
    // if (typeof MeshTopologyManager !== 'undefined') {
    //   this.topology = new MeshTopologyManager(identity, router, peerManager);
    // }

    // Statistics tracking
    this.stats = {
      totalAttempts: 0,
      successfulReconnections: 0,
      failedReconnections: 0,
      coldStarts: 0,
      warmStarts: 0,
      totalDuration: 0,
      averageDuration: 0,
      lastReconnectionTime: null,
      methodBreakdown: {
        direct_cached: 0,
        mesh_relay: 0,
        cold_start: 0,
        failed: 0,
      },
    };

    // State
    this.isReconnecting = false;
    this.lastReconnectionResult = null;

    console.log('[MasterReconnection] Initialized with all child managers');
  }

  // ===========================================================================
  // MAIN RECONNECTION ORCHESTRATOR
  // ===========================================================================

  /**
   * Main reconnection orchestrator - handles all scenarios
   *
   * Automatically detects cold start (0 connections) vs warm start (has connections)
   * and applies the appropriate recovery strategy.
   *
   * @returns {Promise<{
   *   success: boolean,
   *   method: string,
   *   peersConnected: number,
   *   duration: number,
   *   attempts: Array<string>,
   *   fallbackRequired?: boolean
   * }>}
   *
   * @example
   * const result = await masterReconnect.reconnectToMesh();
   * console.log(`Method: ${result.method}, Peers: ${result.peersConnected}, Time: ${result.duration}ms`);
   */
  async reconnectToMesh() {
    if (this.isReconnecting) {
      console.warn('[MasterReconnection] Reconnection already in progress');
      return {
        success: false,
        method: 'concurrent_attempt_blocked',
        peersConnected: 0,
        duration: 0,
        attempts: [],
      };
    }

    this.isReconnecting = true;
    this.stats.totalAttempts++;

    console.log('═════════════════════════════════════');
    console.log('🔄 MESH RECONNECTION INITIATED');
    console.log('═════════════════════════════════════');

    const startTime = Date.now();
    const results = {
      success: false,
      method: null,
      peersConnected: 0,
      duration: 0,
      attempts: [],
    };

    try {
      // Get current connection count (with retries to ensure accuracy)
      const currentConnections = await this.getCurrentConnectionCount();

      // =====================================================================
      // SCENARIO 1: COLD START (0 Active Connections)
      // =====================================================================
      if (currentConnections === 0) {
        console.log('❄️  COLD START: No active connections detected');
        console.log('    Initiating multi-layer recovery protocol...');

        this.stats.coldStarts++;
        results.attempts.push('cold_start');

        const coldResult = await this.coldStart.handleColdStart();

        if (coldResult.success) {
          results.success = true;
          results.method = coldResult.method || 'cold_start';
          results.peersConnected = coldResult.connected || 1;
          results.duration = Date.now() - startTime;

          this.stats.successfulReconnections++;
          this.stats.methodBreakdown.cold_start++;

          // Once we have warm connection, run post-reconnection setup
          await this.postReconnectionSetup();

          console.log('✅ Cold start successful via', results.method);
          console.log(`   Connected to ${results.peersConnected} peer(s) in ${results.duration}ms`);
        } else {
          // Cold start failed completely
          results.success = false;
          results.method = 'cold_start_failed';
          results.fallbackRequired = coldResult.fallbackRequired || true;
          results.duration = Date.now() - startTime;

          this.stats.failedReconnections++;
          this.stats.methodBreakdown.failed++;

          console.warn('❌ Cold start failed, manual intervention may be required');

          if (this.config.COLD_START.AUTO_FALLBACK && coldResult.fallbackRequired) {
            console.log('   Triggering fallback to initial pairing...');
            await this.coldStart.fallbackToInitialPairing();
          }
        }

        this.isReconnecting = false;
        this.lastReconnectionResult = results;
        this.updateStatistics(results);
        return results;
      }

      // =====================================================================
      // SCENARIO 2: WARM START (Has Active Connections)
      // =====================================================================
      console.log(`🌡️  WARM START: ${currentConnections} active connection(s) detected`);
      console.log('    Using mesh network for reconnection...');

      this.stats.warmStarts++;

      // Step 1: Announce our presence to the mesh
      console.log('\n[Step 1/4] Announcing presence to mesh...');
      results.attempts.push('announcement');

      await new Promise(resolve =>
        setTimeout(resolve, this.config.WARM_START.ANNOUNCEMENT_DELAY)
      );

      await this.announcements.announcePresence('rejoin');
      console.log('   ✓ Presence announced');

      // Step 2: Optional topology discovery
      if (this.topology && this.config.WARM_START.ENABLE_TOPOLOGY_DISCOVERY) {
        console.log('[Step 2/4] Discovering mesh topology...');
        results.attempts.push('topology_discovery');

        try {
          await Promise.race([
            this.topology.discoverTopology(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('topology_timeout')),
                this.config.WARM_START.TOPOLOGY_DISCOVERY_TIMEOUT
              )
            ),
          ]);
          console.log('   ✓ Topology discovered');
        } catch (error) {
          console.log('   ⚠ Topology discovery failed or timed out (non-critical)');
        }
      } else {
        console.log('[Step 2/4] Topology discovery disabled, skipping...');
      }

      // Step 3: Get desired peers for reconnection
      console.log('[Step 3/4] Identifying reconnection candidates...');
      const desiredPeers = await this.getDesiredPeers();

      if (desiredPeers.length === 0) {
        console.log('   No peers available for reconnection');
        results.success = true;
        results.method = 'warm_reconnection';
        results.peersConnected = currentConnections;
        results.duration = Date.now() - startTime;

        this.isReconnecting = false;
        this.lastReconnectionResult = results;
        this.updateStatistics(results);
        return results;
      }

      console.log(`   Found ${desiredPeers.length} reconnection candidate(s):`);
      desiredPeers.slice(0, 5).forEach((peer, idx) => {
        console.log(`   ${idx + 1}. ${peer.displayName} (${peer.peerId.substring(0, 8)}...)`);
      });

      // Step 4: Reconnect to peers using cascading fallback
      console.log(`[Step 4/4] Reconnecting to peers...`);
      results.attempts.push('peer_reconnection');

      let reconnectedCount = 0;
      const maxPeers = Math.min(
        desiredPeers.length,
        this.config.WARM_START.MAX_PEERS_TO_RECONNECT
      );

      for (let i = 0; i < maxPeers; i++) {
        const peer = desiredPeers[i];

        // Skip if already connected
        if (this.peerManager.peers.has(peer.peerId)) {
          console.log(`   ⏭  ${peer.displayName} already connected, skipping`);
          continue;
        }

        console.log(`\n   🔗 [${i + 1}/${maxPeers}] Reconnecting to ${peer.displayName}...`);

        const peerResult = await this.reconnectToPeer(peer);

        if (peerResult.success) {
          reconnectedCount++;
          console.log(`      ✅ Success via ${peerResult.method} (${peerResult.duration}ms)`);

          // Track which method succeeded
          if (this.stats.methodBreakdown[peerResult.method] !== undefined) {
            this.stats.methodBreakdown[peerResult.method]++;
          }

          // Early exit if threshold reached
          if (this.config.WARM_START.EARLY_EXIT_THRESHOLD &&
              reconnectedCount >= this.config.WARM_START.EARLY_EXIT_THRESHOLD) {
            console.log(`   ⚡ Early exit: reached ${reconnectedCount} connections`);
            break;
          }
        } else {
          console.log(`      ❌ Failed: ${peerResult.reason}`);
        }
      }

      // Final results
      results.success = true; // Warm start is always "successful" even if 0 new connections
      results.method = 'warm_reconnection';
      results.peersConnected = reconnectedCount;
      results.duration = Date.now() - startTime;

      if (reconnectedCount > 0) {
        this.stats.successfulReconnections++;
      }

      console.log('\n═════════════════════════════════════');
      console.log('✅ RECONNECTION COMPLETE');
      console.log(`   New connections: ${reconnectedCount}/${maxPeers}`);
      console.log(`   Total time: ${results.duration}ms`);
      console.log(`   Method: ${results.method}`);
      console.log('═════════════════════════════════════');

    } catch (error) {
      console.error('[MasterReconnection] Unexpected error:', error);

      results.success = false;
      results.method = 'error';
      results.error = error.message;
      results.duration = Date.now() - startTime;

      this.stats.failedReconnections++;
      this.stats.methodBreakdown.failed++;
    } finally {
      this.isReconnecting = false;
      this.lastReconnectionResult = results;
      this.updateStatistics(results);
    }

    return results;
  }

  // ===========================================================================
  // CASCADING FALLBACK STRATEGY (PER PEER)
  // ===========================================================================

  /**
   * Reconnect to individual peer with cascading fallbacks
   *
   * Tries multiple strategies in order of speed/reliability:
   * 1. Direct reconnection (fast, low success rate)
   * 2. Mesh relay (slower, high success rate)
   *
   * @param {Object} peer - Peer data from persistence
   * @returns {Promise<{
   *   success: boolean,
   *   method?: string,
   *   reason?: string,
   *   duration: number
   * }>}
   *
   * @example
   * const result = await masterReconnect.reconnectToPeer(peerData);
   * if (result.success) {
   *   console.log(`Connected via ${result.method}`);
   * }
   */
  async reconnectToPeer(peer) {
    const startTime = Date.now();

    // Strategy cascade: fast → reliable
    const strategies = [
      {
        name: 'direct_cached',
        timeout: this.config.TIMEOUTS.DIRECT,
        fn: () => this.directReconnect.attemptDirectReconnection(
          peer.peerId,
          this.config.TIMEOUTS.DIRECT
        ),
      },
      {
        name: 'mesh_relay',
        timeout: this.config.TIMEOUTS.MESH_RELAY,
        fn: () => this.meshReconnect.reconnectViaMesh(
          peer.peerId,
          peer.displayName
        ),
      },
    ];

    // Try each strategy in sequence
    for (const strategy of strategies) {
      console.log(`      → Trying ${strategy.name}...`);

      const strategyStartTime = Date.now();

      try {
        const result = await strategy.fn();
        const duration = Date.now() - strategyStartTime;

        if (result.success) {
          return {
            success: true,
            method: strategy.name,
            duration: Date.now() - startTime,
          };
        }

        console.log(`        ✗ ${strategy.name} failed: ${result.reason || 'unknown'} (${duration}ms)`);

      } catch (error) {
        const duration = Date.now() - strategyStartTime;
        console.log(`        ✗ ${strategy.name} error: ${error.message} (${duration}ms)`);
      }

      // Check if we've exceeded total time budget
      if (Date.now() - startTime >= this.config.TIMEOUTS.TOTAL_PER_PEER) {
        console.log(`        ⏱ Time budget exceeded for ${peer.displayName}`);
        break;
      }
    }

    // All strategies failed
    return {
      success: false,
      reason: 'all_strategies_failed',
      duration: Date.now() - startTime,
    };
  }

  // ===========================================================================
  // IP CHANGE HANDLING
  // ===========================================================================

  /**
   * Handle IP address change scenario
   *
   * When a peer's IP address changes (e.g., network switch, VPN toggle),
   * announce the change with cryptographic proof and let other peers
   * reconnect to us.
   *
   * @returns {Promise<boolean>} Success status
   *
   * @example
   * // Listen for network changes
   * window.addEventListener('online', async () => {
   *   await masterReconnect.handleIpChange();
   * });
   */
  async handleIpChange() {
    console.log('═════════════════════════════════════');
    console.log('🔄 IP ADDRESS CHANGED');
    console.log('═════════════════════════════════════');

    try {
      // Announce IP change with cryptographic proof
      console.log('   Broadcasting IP change announcement...');
      await this.announcements.announceIpChange();

      // Give mesh time to propagate announcement
      console.log('   Waiting for mesh propagation (3s)...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      console.log('✅ IP change announced successfully');
      console.log('   Waiting for peer reconnections...');
      console.log('═════════════════════════════════════');

      return true;

    } catch (error) {
      console.error('[MasterReconnection] IP change announcement failed:', error);
      return false;
    }
  }

  // ===========================================================================
  // PEER SELECTION
  // ===========================================================================

  /**
   * Get desired peers for reconnection
   *
   * Selects peers from persistence based on:
   * - Approval status (must be fully approved)
   * - Recent activity (prefer recently seen)
   * - Connection quality (high success rate, low latency)
   * - Not currently connected
   * - Not blacklisted
   *
   * @returns {Promise<Array<Object>>} Prioritized list of peers
   *
   * @example
   * const peers = await masterReconnect.getDesiredPeers();
   * console.log(`Found ${peers.length} reconnection candidates`);
   */
  async getDesiredPeers() {
    try {
      // Get high-quality reconnection candidates from persistence
      const candidates = await this.peerPersistence.getReconnectionCandidates({
        limit: 20, // Get top 20 quality candidates
        maxAge: 7 * 24 * 60 * 60 * 1000, // Last 7 days
        minQuality: 20, // Reasonable quality threshold
      });

      if (candidates.length === 0) {
        console.log('[MasterReconnection] No quality candidates found in persistence');
        return [];
      }

      // Extract peer objects from candidates
      const peers = candidates.map(c => c.peer);

      console.log(`[MasterReconnection] Selected ${peers.length} reconnection candidates`);

      return peers;

    } catch (error) {
      console.error('[MasterReconnection] Error getting desired peers:', error);
      return [];
    }
  }

  // ===========================================================================
  // POST-RECONNECTION SETUP
  // ===========================================================================

  /**
   * Post-reconnection setup
   *
   * After successful reconnection (especially from cold start), perform
   * additional setup to maintain mesh health:
   * - Start periodic announcements
   * - Discover mesh topology
   * - Update peer persistence records
   *
   * @returns {Promise<void>}
   */
  async postReconnectionSetup() {
    console.log('[MasterReconnection] Running post-reconnection setup...');

    try {
      // Start periodic announcements (heartbeat)
      if (this.config.POST_RECONNECTION.ENABLE_PERIODIC_ANNOUNCEMENTS) {
        this.announcements.startPeriodicAnnouncements();
        console.log('   ✓ Started periodic announcements');
      }

      // Discover mesh topology (optional)
      if (this.topology && this.config.POST_RECONNECTION.ENABLE_TOPOLOGY_DISCOVERY) {
        await this.topology.discoverTopology().catch(() => {
          console.log('   ⚠ Topology discovery failed (non-critical)');
        });
        console.log('   ✓ Topology discovery initiated');
      }

      // Update peer persistence
      if (this.config.POST_RECONNECTION.UPDATE_PERSISTENCE) {
        const connectedPeers = this.peerManager.getAllConnectedPeers ?
          this.peerManager.getAllConnectedPeers() :
          this.peerManager.peers;

        for (const [peerId, peerData] of connectedPeers) {
          if (peerData.status === 'connected') {
            await this.peerPersistence.updateLastSeen(peerId);
          }
        }
        console.log('   ✓ Updated peer persistence records');
      }

      console.log('[MasterReconnection] Post-reconnection setup complete');

    } catch (error) {
      console.error('[MasterReconnection] Post-reconnection setup error:', error);
      // Non-critical, don't throw
    }
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get comprehensive statistics from all managers
   *
   * @returns {Object} Aggregated statistics
   *
   * @example
   * const stats = masterReconnect.getStats();
   * console.log(`Success rate: ${stats.successRate}`);
   * console.log(`Average duration: ${stats.averageDuration}ms`);
   */
  getStats() {
    return {
      // Overall stats
      totalAttempts: this.stats.totalAttempts,
      successfulReconnections: this.stats.successfulReconnections,
      failedReconnections: this.stats.failedReconnections,
      coldStarts: this.stats.coldStarts,
      warmStarts: this.stats.warmStarts,
      averageDuration: this.stats.averageDuration,
      lastReconnectionTime: this.stats.lastReconnectionTime,
      successRate: this.stats.totalAttempts > 0
        ? ((this.stats.successfulReconnections / this.stats.totalAttempts) * 100).toFixed(1) + '%'
        : 'N/A',

      // Method breakdown
      methodBreakdown: { ...this.stats.methodBreakdown },

      // Last result
      lastResult: this.lastReconnectionResult,

      // Child manager stats
      directReconnection: this.directReconnect.getStatistics ?
        this.directReconnect.getStatistics() :
        null,

      meshRelay: this.meshReconnect.getStats(),

      announcements: this.announcements.getStats(),

      coldStart: this.coldStart.getStats(),

      topology: this.topology ?
        this.topology.getStats() :
        null,
    };
  }

  /**
   * Update statistics after reconnection attempt
   * @private
   */
  updateStatistics(results) {
    this.stats.lastReconnectionTime = Date.now();
    this.stats.totalDuration += results.duration;

    if (this.stats.totalAttempts > 0) {
      this.stats.averageDuration = Math.round(
        this.stats.totalDuration / this.stats.totalAttempts
      );
    }
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Get current connection count with retries for accuracy
   * @private
   */
  async getCurrentConnectionCount() {
    let count = 0;

    for (let i = 0; i < this.config.LIMITS.CONNECTION_CHECK_RETRIES; i++) {
      count = this.peerManager.getConnectedPeerCount ?
        this.peerManager.getConnectedPeerCount() :
        Array.from(this.peerManager.peers.values())
          .filter(p => p.status === 'connected').length;

      if (count > 0 || i === this.config.LIMITS.CONNECTION_CHECK_RETRIES - 1) {
        break;
      }

      // Wait before retry
      await new Promise(resolve =>
        setTimeout(resolve, this.config.LIMITS.CONNECTION_CHECK_DELAY)
      );
    }

    return count;
  }

  /**
   * Check if system is currently reconnecting
   * @returns {boolean}
   */
  isCurrentlyReconnecting() {
    return this.isReconnecting;
  }

  /**
   * Get last reconnection result
   * @returns {Object|null}
   */
  getLastReconnectionResult() {
    return this.lastReconnectionResult;
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Stop all managers and cleanup
   *
   * Should be called on application shutdown or user logout.
   *
   * @example
   * window.addEventListener('beforeunload', () => {
   *   masterReconnect.destroy();
   * });
   */
  destroy() {
    console.log('[MasterReconnection] Cleaning up reconnection system...');

    try {
      // Stop periodic announcements
      this.announcements.stopPeriodicAnnouncements();

      // Stop topology discovery if active
      if (this.topology && typeof this.topology.stopTopologyDiscovery === 'function') {
        this.topology.stopTopologyDiscovery();
      }

      // Cleanup cold start manager
      if (typeof this.coldStart.destroy === 'function') {
        this.coldStart.destroy();
      }

      // Stop mesh reconnection manager
      if (typeof this.meshReconnect.stop === 'function') {
        this.meshReconnect.stop();
      }

      // Stop direct reconnection monitoring
      if (typeof this.directReconnect.stopMonitoring === 'function') {
        this.directReconnect.stopMonitoring();
      }

      console.log('[MasterReconnection] Cleanup complete');

    } catch (error) {
      console.error('[MasterReconnection] Error during cleanup:', error);
    }
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default MasterReconnectionStrategy;
