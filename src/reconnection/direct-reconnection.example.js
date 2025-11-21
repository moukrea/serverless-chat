/**
 * DirectReconnectionManager - Usage Examples
 *
 * This file demonstrates how to integrate and use the DirectReconnectionManager
 * for fast WebRTC reconnection in your P2P mesh chat application.
 */

import DirectReconnectionManager from './direct-reconnection.js';
import peerPersistence from '../storage/peer-persistence.js';

// =============================================================================
// EXAMPLE 1: Basic Setup and Integration
// =============================================================================

/**
 * Initialize the DirectReconnectionManager with your application's dependencies
 */
function setupReconnectionManager(identity, peerManager) {
  const reconnectionManager = new DirectReconnectionManager(
    identity,
    peerManager,
    peerPersistence
  );

  console.log('DirectReconnectionManager initialized');
  return reconnectionManager;
}

// =============================================================================
// EXAMPLE 2: Attempting Reconnection on Page Load
// =============================================================================

/**
 * On application startup, try to reconnect to previously known peers
 */
async function reconnectOnStartup(reconnectionManager) {
  console.log('=== Attempting reconnection to cached peers ===');

  // Get reconnection candidates sorted by priority
  const candidates = await peerPersistence.getReconnectionCandidates({
    limit: 5,  // Try top 5 peers
    maxAge: 7 * 24 * 60 * 60 * 1000  // Within last 7 days
  });

  console.log(`Found ${candidates.length} reconnection candidates`);

  const results = [];

  for (const candidate of candidates) {
    const { peer, score, reason } = candidate;

    console.log(`\nAttempting reconnection to ${peer.displayName} (${peer.peerId.substring(0, 8)})`);
    console.log(`  Score: ${score}/100, Reason: ${reason}`);

    // Check probability before attempting
    const probability = reconnectionManager.getReconnectionProbability(peer);
    console.log(`  Probability: ${probability.likelihood} (${probability.score}%) - ${probability.factors.join(', ')}`);

    // Attempt reconnection
    const result = await reconnectionManager.attemptDirectReconnection(peer.peerId, 8000);

    if (result.success) {
      console.log(`  ✓ SUCCESS: Reconnected via ${result.method} in ${result.duration}ms`);
      results.push({ peerId: peer.peerId, success: true, duration: result.duration });
    } else {
      console.log(`  ✗ FAILED: ${result.reason} (${result.duration}ms)`);
      results.push({ peerId: peer.peerId, success: false, reason: result.reason });
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`\n=== Reconnection summary: ${successCount}/${candidates.length} successful ===`);

  return results;
}

// =============================================================================
// EXAMPLE 3: Monitoring Active Connections
// =============================================================================

/**
 * Monitor an active peer connection to cache data for future reconnection
 */
function setupPeerMonitoring(reconnectionManager, peerId, peerName, simplePeerInstance) {
  console.log(`Setting up monitoring for ${peerName} (${peerId.substring(0, 8)})`);

  // Start monitoring when peer connects
  simplePeerInstance.on('connect', () => {
    console.log(`  Peer ${peerName} connected - starting monitoring`);
    reconnectionManager.monitorPeerConnection(peerId, peerName, simplePeerInstance);
  });

  // Handle disconnection
  simplePeerInstance.on('close', () => {
    console.log(`  Peer ${peerName} disconnected - data cached for future reconnection`);
  });

  // Handle errors
  simplePeerInstance.on('error', (err) => {
    console.error(`  Peer ${peerName} error: ${err.message}`);
  });
}

// =============================================================================
// EXAMPLE 4: Smart Reconnection Strategy
// =============================================================================

/**
 * Implement a smart reconnection strategy that tries direct reconnection first,
 * then falls back to normal signaling server connection
 */
async function smartReconnect(reconnectionManager, signalServerConnect, peerId) {
  console.log(`\n=== Smart reconnection to ${peerId.substring(0, 8)} ===`);

  // Step 1: Check if we have cached data
  const cached = await peerPersistence.getPeer(peerId);

  if (!cached) {
    console.log('No cached data - using signaling server');
    return await signalServerConnect(peerId);
  }

  // Step 2: Check cache validity
  if (!reconnectionManager.isCacheValid(cached)) {
    console.log('Cache expired - using signaling server');
    return await signalServerConnect(peerId);
  }

  // Step 3: Check reconnection probability
  const probability = reconnectionManager.getReconnectionProbability(cached);
  console.log(`Probability: ${probability.likelihood} (${probability.score}%)`);

  // Step 4: Only attempt direct reconnection if probability is reasonable
  if (probability.score < 15) {
    console.log('Probability too low - using signaling server');
    return await signalServerConnect(peerId);
  }

  // Step 5: Attempt direct reconnection with timeout
  console.log('Attempting direct reconnection...');
  const startTime = Date.now();

  const result = await reconnectionManager.attemptDirectReconnection(peerId, 5000);

  if (result.success) {
    console.log(`✓ Direct reconnection successful in ${result.duration}ms`);
    return { success: true, method: 'direct', duration: result.duration };
  }

  // Step 6: Fallback to signaling server
  const directAttemptDuration = Date.now() - startTime;
  console.log(`✗ Direct reconnection failed (${result.reason}) after ${directAttemptDuration}ms`);
  console.log('Falling back to signaling server...');

  try {
    const signalResult = await signalServerConnect(peerId);
    const totalDuration = Date.now() - startTime;

    console.log(`✓ Connected via signaling server (total time: ${totalDuration}ms)`);
    return {
      success: true,
      method: 'signaling_server',
      duration: totalDuration,
      directAttemptFailed: result.reason
    };
  } catch (error) {
    console.error('✗ Signaling server connection also failed:', error);
    return {
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    };
  }
}

// =============================================================================
// EXAMPLE 5: Automatic Cleanup and Maintenance
// =============================================================================

/**
 * Periodically clean up stale cached data and get statistics
 */
async function maintenanceTask(reconnectionManager) {
  console.log('\n=== Running maintenance task ===');

  // Get statistics
  const stats = await reconnectionManager.getStatistics();
  console.log('Cache statistics:');
  console.log(`  Total cached peers: ${stats.totalCached}`);
  console.log(`  Valid cache entries: ${stats.validCache}`);
  console.log(`  By connection type:`, stats.byType);
  console.log(`  By age:`, stats.byAge);

  // Clean up stale data if needed
  if (await peerPersistence.needsCleanup()) {
    console.log('Cleanup needed - running cleanup...');
    const removed = await peerPersistence.cleanupStalePeers();
    console.log(`  Removed ${removed} stale peers`);
  }

  // Clear expired blacklists
  const cleared = await peerPersistence.clearExpiredBlacklists();
  if (cleared > 0) {
    console.log(`  Cleared ${cleared} expired blacklists`);
  }
}

// =============================================================================
// EXAMPLE 6: Complete Application Integration
// =============================================================================

/**
 * Complete integration example showing the full reconnection flow
 */
class ChatApplication {
  constructor(identity, peerManager, signalServerClient) {
    this.identity = identity;
    this.peerManager = peerManager;
    this.signalServerClient = signalServerClient;

    // Initialize reconnection manager
    this.reconnectionManager = new DirectReconnectionManager(
      identity,
      peerManager,
      peerPersistence
    );

    // Start maintenance timer (run every hour)
    this.maintenanceTimer = setInterval(() => {
      this.runMaintenance();
    }, 60 * 60 * 1000);
  }

  /**
   * Initialize application - try to reconnect to previous peers
   */
  async initialize() {
    console.log('Initializing chat application...');

    // Try to reconnect to cached peers
    await this.reconnectCachedPeers();

    // If no successful reconnections, connect via signaling server
    if (this.peerManager.getConnectedPeerCount() === 0) {
      console.log('No direct reconnections successful - discovering new peers');
      await this.discoverPeers();
    }
  }

  /**
   * Reconnect to cached peers on startup
   */
  async reconnectCachedPeers() {
    const candidates = await peerPersistence.getReconnectionCandidates({
      limit: 10,
      maxAge: 24 * 60 * 60 * 1000  // Last 24 hours
    });

    console.log(`Attempting reconnection to ${candidates.length} cached peers...`);

    // Try reconnections in parallel (but with staggered start for politeness)
    const reconnectionPromises = candidates.map((candidate, index) => {
      return new Promise(async (resolve) => {
        // Stagger attempts by 500ms each
        await new Promise(r => setTimeout(r, index * 500));

        const result = await this.reconnectionManager.attemptDirectReconnection(
          candidate.peer.peerId,
          8000
        );

        resolve(result);
      });
    });

    const results = await Promise.allSettled(reconnectionPromises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;

    console.log(`Direct reconnection: ${successful}/${candidates.length} successful`);
  }

  /**
   * Connect to a specific peer (with smart reconnection)
   */
  async connectToPeer(peerId) {
    return await smartReconnect(
      this.reconnectionManager,
      (pId) => this.signalServerClient.connect(pId),
      peerId
    );
  }

  /**
   * Handle new peer connection (setup monitoring)
   */
  handleNewPeerConnection(peerId, peerName, simplePeerInstance) {
    console.log(`New peer connected: ${peerName}`);

    // Monitor the connection for future reconnection
    this.reconnectionManager.monitorPeerConnection(peerId, peerName, simplePeerInstance);

    // Update persistence with connection info
    peerPersistence.updateLastSeen(peerId);
  }

  /**
   * Handle peer disconnection
   */
  async handlePeerDisconnection(peerId) {
    console.log(`Peer disconnected: ${peerId.substring(0, 8)}`);

    // Update last seen
    await peerPersistence.updateLastSeen(peerId);

    // Connection data is already cached by monitorPeerConnection
  }

  /**
   * Discover new peers via signaling server
   */
  async discoverPeers() {
    // Implementation depends on your signaling server protocol
    console.log('Discovering peers via signaling server...');
    // ...
  }

  /**
   * Run periodic maintenance
   */
  async runMaintenance() {
    await maintenanceTask(this.reconnectionManager);
  }

  /**
   * Cleanup on application shutdown
   */
  cleanup() {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
    }

    this.reconnectionManager.stopMonitoring();
  }
}

// =============================================================================
// EXAMPLE 7: Testing and Debugging
// =============================================================================

/**
 * Test and debug reconnection functionality
 */
async function debugReconnection(reconnectionManager, peerId) {
  console.log('\n=== Debugging reconnection for', peerId.substring(0, 8), '===');

  // Get cached data
  const cached = await peerPersistence.getPeer(peerId);

  if (!cached) {
    console.log('No cached data available');
    return;
  }

  console.log('\nCached peer data:');
  console.log(`  Display name: ${cached.displayName}`);
  console.log(`  First seen: ${new Date(cached.firstSeen).toLocaleString()}`);
  console.log(`  Last seen: ${new Date(cached.lastSeen).toLocaleString()}`);
  console.log(`  Last connected: ${new Date(cached.lastConnected).toLocaleString()}`);

  // Cache age
  const age = Date.now() - cached.lastSeen;
  console.log(`  Cache age: ${Math.floor(age / 1000)}s (${Math.floor(age / 60000)}m)`);

  // Connection quality
  const quality = cached.connectionQuality || {};
  console.log('\nConnection quality:');
  console.log(`  Type: ${quality.connectionType || 'unknown'}`);
  console.log(`  Latency: ${quality.latency !== null ? quality.latency + 'ms' : 'unknown'}`);
  console.log(`  Success rate: ${quality.successRate ? (quality.successRate * 100).toFixed(1) + '%' : 'unknown'}`);
  console.log(`  Total connections: ${quality.totalConnections || 0}`);
  console.log(`  Successful: ${quality.successfulConnections || 0}`);

  // Reconnection attempts
  console.log(`  Failed attempts: ${cached.reconnectionAttempts || 0}`);
  if (cached.blacklistUntil) {
    const isBlacklisted = cached.blacklistUntil > Date.now();
    console.log(`  Blacklisted: ${isBlacklisted ? 'YES until ' + new Date(cached.blacklistUntil).toLocaleString() : 'no'}`);
  }

  // Cached candidates
  console.log(`\nCached ICE candidates: ${cached.cachedCandidates?.length || 0}`);
  if (cached.cachedCandidates?.length > 0) {
    const types = {};
    cached.cachedCandidates.forEach(c => {
      types[c.candidateType] = (types[c.candidateType] || 0) + 1;
    });
    console.log('  By type:', types);
  }

  // Check validity
  const isValid = reconnectionManager.isCacheValid(cached);
  console.log(`\nCache valid: ${isValid ? 'YES' : 'NO'}`);

  // Get probability
  const probability = reconnectionManager.getReconnectionProbability(cached);
  console.log('\nReconnection probability:');
  console.log(`  Likelihood: ${probability.likelihood}`);
  console.log(`  Score: ${probability.score}/100`);
  console.log(`  Factors: ${probability.factors.join(', ')}`);

  // Attempt reconnection
  console.log('\nAttempting reconnection...');
  const result = await reconnectionManager.attemptDirectReconnection(peerId, 10000);

  console.log('\nResult:');
  console.log(`  Success: ${result.success}`);
  console.log(`  Method: ${result.method || 'n/a'}`);
  console.log(`  Reason: ${result.reason || 'n/a'}`);
  console.log(`  Duration: ${result.duration}ms`);

  return result;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  setupReconnectionManager,
  reconnectOnStartup,
  setupPeerMonitoring,
  smartReconnect,
  maintenanceTask,
  debugReconnection,
  ChatApplication
};
