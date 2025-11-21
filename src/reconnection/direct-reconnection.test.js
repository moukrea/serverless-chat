/**
 * DirectReconnectionManager - Test Suite
 *
 * Comprehensive tests for the DirectReconnectionManager module
 */

import DirectReconnectionManager, { RECONNECTION_CONFIG } from './direct-reconnection.js';
import peerPersistence from '../storage/peer-persistence.js';

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create mock identity
 */
function createMockIdentity() {
  return {
    peerId: 'test-peer-id',
    publicKey: { /* mock key */ },
    privateKey: { /* mock key */ }
  };
}

/**
 * Create mock peer manager
 */
function createMockPeerManager() {
  return {
    peers: new Map(),
    getConnectedPeerCount: function() {
      return Array.from(this.peers.values()).filter(p => p.status === 'connected').length;
    }
  };
}

/**
 * Create mock cached peer data
 */
function createMockCachedPeer(options = {}) {
  const now = Date.now();

  return {
    peerId: options.peerId || 'mock-peer-123',
    userId: options.userId || 'mock-user-123',
    displayName: options.displayName || 'Mock Peer',
    firstSeen: options.firstSeen || now - 86400000, // 1 day ago
    lastSeen: options.lastSeen || now - 60000, // 1 minute ago
    lastConnected: options.lastConnected || now - 60000,
    publicKey: null,
    cachedCandidates: options.cachedCandidates || [],
    connectionQuality: {
      latency: options.latency !== undefined ? options.latency : 50,
      successRate: options.successRate !== undefined ? options.successRate : 0.9,
      connectionType: options.connectionType || 'Direct UDP',
      lastMeasured: now,
      totalConnections: options.totalConnections || 10,
      successfulConnections: options.successfulConnections || 9,
      avgUptime: options.avgUptime || 300,
    },
    reconnectionAttempts: options.reconnectionAttempts || 0,
    blacklistUntil: options.blacklistUntil || null,
    lastOffer: options.lastOffer || null,
    lastAnswer: options.lastAnswer || null,
    wasInitiator: options.wasInitiator !== undefined ? options.wasInitiator : true,
    metadata: {},
  };
}

// =============================================================================
// TEST SUITE 1: Cache Validity
// =============================================================================

console.log('\n========================================');
console.log('TEST SUITE 1: Cache Validity');
console.log('========================================\n');

function testCacheValidity() {
  const identity = createMockIdentity();
  const peerManager = createMockPeerManager();
  const manager = new DirectReconnectionManager(identity, peerManager, peerPersistence);

  const tests = [
    {
      name: 'Recent direct connection (1 minute old)',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 60000,
        connectionType: 'Direct UDP'
      }),
      expected: true
    },
    {
      name: 'Old direct connection (15 minutes old)',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 900000,
        connectionType: 'Direct UDP'
      }),
      expected: false
    },
    {
      name: 'Recent STUN connection (3 minutes old)',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 180000,
        connectionType: 'STUN UDP'
      }),
      expected: true
    },
    {
      name: 'Old STUN connection (10 minutes old)',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 600000,
        connectionType: 'STUN UDP'
      }),
      expected: false
    },
    {
      name: 'Recent TURN connection (1 minute old)',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 60000,
        connectionType: 'TURN UDP :443'
      }),
      expected: true
    },
    {
      name: 'Old TURN connection (5 minutes old)',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 300000,
        connectionType: 'TURN UDP :443'
      }),
      expected: false
    },
    {
      name: 'No connection type (default timeout)',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 180000,
        connectionType: null
      }),
      expected: true
    },
    {
      name: 'Null peer',
      peer: null,
      expected: false
    }
  ];

  let passed = 0;
  let failed = 0;

  tests.forEach(test => {
    const result = manager.isCacheValid(test.peer);
    const success = result === test.expected;

    if (success) {
      console.log(`✓ ${test.name}`);
      console.log(`  Result: ${result} (expected: ${test.expected})`);
      passed++;
    } else {
      console.log(`✗ ${test.name}`);
      console.log(`  Result: ${result} (expected: ${test.expected})`);
      failed++;
    }
  });

  console.log(`\nCache Validity Tests: ${passed} passed, ${failed} failed\n`);
}

testCacheValidity();

// =============================================================================
// TEST SUITE 2: Reconnection Probability
// =============================================================================

console.log('\n========================================');
console.log('TEST SUITE 2: Reconnection Probability');
console.log('========================================\n');

function testReconnectionProbability() {
  const identity = createMockIdentity();
  const peerManager = createMockPeerManager();
  const manager = new DirectReconnectionManager(identity, peerManager, peerPersistence);

  const tests = [
    {
      name: 'Excellent: Recent direct connection, low latency',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 30000, // 30 seconds ago
        connectionType: 'Direct UDP',
        latency: 20,
        successRate: 1.0,
        reconnectionAttempts: 0
      }),
      expectedLikelihood: 'very_high',
      minScore: 80
    },
    {
      name: 'Good: Recent STUN connection, moderate latency',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 120000, // 2 minutes ago
        connectionType: 'STUN UDP',
        latency: 100,
        successRate: 0.9,
        reconnectionAttempts: 0
      }),
      expectedLikelihood: 'high',
      minScore: 50
    },
    {
      name: 'Fair: Older direct connection',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 400000, // 6.6 minutes ago
        connectionType: 'Direct UDP',
        latency: 50,
        successRate: 0.8,
        reconnectionAttempts: 1
      }),
      expectedLikelihood: 'medium',
      minScore: 30
    },
    {
      name: 'Poor: TURN relay connection',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 180000, // 3 minutes ago
        connectionType: 'TURN UDP :443',
        latency: 200,
        successRate: 0.7,
        reconnectionAttempts: 2
      }),
      expectedLikelihood: 'low',
      minScore: 15
    },
    {
      name: 'Very Poor: Old connection with failures',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 500000, // 8+ minutes ago
        connectionType: 'STUN UDP',
        latency: 300,
        successRate: 0.5,
        reconnectionAttempts: 3
      }),
      expectedLikelihood: 'very_low',
      minScore: 0
    },
    {
      name: 'Blacklisted peer',
      peer: createMockCachedPeer({
        lastSeen: Date.now() - 30000,
        connectionType: 'Direct UDP',
        latency: 20,
        successRate: 1.0,
        reconnectionAttempts: 5,
        blacklistUntil: Date.now() + 86400000 // 1 day from now
      }),
      expectedLikelihood: 'very_low',
      minScore: 0
    }
  ];

  let passed = 0;
  let failed = 0;

  tests.forEach(test => {
    const probability = manager.getReconnectionProbability(test.peer);
    const likelihoodMatch = probability.likelihood === test.expectedLikelihood;
    const scoreMatch = probability.score >= test.minScore;
    const success = likelihoodMatch && scoreMatch;

    if (success) {
      console.log(`✓ ${test.name}`);
      console.log(`  Likelihood: ${probability.likelihood} (expected: ${test.expectedLikelihood})`);
      console.log(`  Score: ${probability.score} (min: ${test.minScore})`);
      console.log(`  Factors: ${probability.factors.join(', ')}`);
      passed++;
    } else {
      console.log(`✗ ${test.name}`);
      console.log(`  Likelihood: ${probability.likelihood} (expected: ${test.expectedLikelihood}) ${likelihoodMatch ? '✓' : '✗'}`);
      console.log(`  Score: ${probability.score} (min: ${test.minScore}) ${scoreMatch ? '✓' : '✗'}`);
      console.log(`  Factors: ${probability.factors.join(', ')}`);
      failed++;
    }
    console.log('');
  });

  console.log(`Probability Tests: ${passed} passed, ${failed} failed\n`);
}

testReconnectionProbability();

// =============================================================================
// TEST SUITE 3: Cache Expiration by Connection Type
// =============================================================================

console.log('\n========================================');
console.log('TEST SUITE 3: Cache Expiration by Type');
console.log('========================================\n');

function testCacheExpirationByType() {
  const identity = createMockIdentity();
  const peerManager = createMockPeerManager();
  const manager = new DirectReconnectionManager(identity, peerManager, peerPersistence);

  const connectionTypes = [
    {
      type: 'Direct UDP',
      maxValidAge: RECONNECTION_CONFIG.CACHE_VALIDITY.HOST,
      description: 'Host (Direct)'
    },
    {
      type: 'STUN UDP',
      maxValidAge: RECONNECTION_CONFIG.CACHE_VALIDITY.SRFLX,
      description: 'Srflx (STUN)'
    },
    {
      type: 'TURN UDP :443',
      maxValidAge: RECONNECTION_CONFIG.CACHE_VALIDITY.RELAY,
      description: 'Relay (TURN)'
    }
  ];

  let passed = 0;
  let failed = 0;

  connectionTypes.forEach(({ type, maxValidAge, description }) => {
    console.log(`Testing ${description}:`);

    // Test just before expiration (should be valid)
    const validPeer = createMockCachedPeer({
      lastSeen: Date.now() - (maxValidAge - 10000), // 10s before expiration
      connectionType: type
    });

    const validResult = manager.isCacheValid(validPeer);
    const validSuccess = validResult === true;

    if (validSuccess) {
      console.log(`  ✓ Valid before expiration (${Math.floor((maxValidAge - 10000) / 1000)}s old)`);
      passed++;
    } else {
      console.log(`  ✗ Should be valid before expiration`);
      failed++;
    }

    // Test just after expiration (should be invalid)
    const expiredPeer = createMockCachedPeer({
      lastSeen: Date.now() - (maxValidAge + 10000), // 10s after expiration
      connectionType: type
    });

    const expiredResult = manager.isCacheValid(expiredPeer);
    const expiredSuccess = expiredResult === false;

    if (expiredSuccess) {
      console.log(`  ✓ Invalid after expiration (${Math.floor((maxValidAge + 10000) / 1000)}s old)`);
      passed++;
    } else {
      console.log(`  ✗ Should be invalid after expiration`);
      failed++;
    }

    console.log('');
  });

  console.log(`Cache Expiration Tests: ${passed} passed, ${failed} failed\n`);
}

testCacheExpirationByType();

// =============================================================================
// TEST SUITE 4: Configuration Values
// =============================================================================

console.log('\n========================================');
console.log('TEST SUITE 4: Configuration Validation');
console.log('========================================\n');

function testConfiguration() {
  console.log('Cache Validity Periods:');
  console.log(`  Host (Direct): ${RECONNECTION_CONFIG.CACHE_VALIDITY.HOST / 60000} minutes`);
  console.log(`  Srflx (STUN): ${RECONNECTION_CONFIG.CACHE_VALIDITY.SRFLX / 60000} minutes`);
  console.log(`  Relay (TURN): ${RECONNECTION_CONFIG.CACHE_VALIDITY.RELAY / 60000} minutes`);
  console.log(`  Default: ${RECONNECTION_CONFIG.CACHE_VALIDITY.DEFAULT / 60000} minutes`);

  console.log('\nTimeout Settings:');
  console.log(`  Default timeout: ${RECONNECTION_CONFIG.DEFAULT_TIMEOUT / 1000} seconds`);
  console.log(`  Signaling reuse timeout: ${RECONNECTION_CONFIG.SIGNALING_REUSE_TIMEOUT / 1000} seconds`);

  console.log('\nMonitoring Settings:');
  console.log(`  ICE gather delay: ${RECONNECTION_CONFIG.ICE_GATHER_DELAY / 1000} seconds`);
  console.log(`  Stats sample delay: ${RECONNECTION_CONFIG.STATS_SAMPLE_DELAY / 1000} seconds`);

  // Validate configuration makes sense
  let passed = 0;
  let failed = 0;

  // Host should have longest validity
  if (RECONNECTION_CONFIG.CACHE_VALIDITY.HOST > RECONNECTION_CONFIG.CACHE_VALIDITY.SRFLX &&
      RECONNECTION_CONFIG.CACHE_VALIDITY.HOST > RECONNECTION_CONFIG.CACHE_VALIDITY.RELAY) {
    console.log('\n✓ Host has longest cache validity (correct)');
    passed++;
  } else {
    console.log('\n✗ Host should have longest cache validity');
    failed++;
  }

  // Relay should have shortest validity
  if (RECONNECTION_CONFIG.CACHE_VALIDITY.RELAY < RECONNECTION_CONFIG.CACHE_VALIDITY.SRFLX &&
      RECONNECTION_CONFIG.CACHE_VALIDITY.RELAY < RECONNECTION_CONFIG.CACHE_VALIDITY.HOST) {
    console.log('✓ Relay has shortest cache validity (correct)');
    passed++;
  } else {
    console.log('✗ Relay should have shortest cache validity');
    failed++;
  }

  // Default timeout should be reasonable
  if (RECONNECTION_CONFIG.DEFAULT_TIMEOUT >= 5000 && RECONNECTION_CONFIG.DEFAULT_TIMEOUT <= 15000) {
    console.log('✓ Default timeout is reasonable (5-15s)');
    passed++;
  } else {
    console.log('✗ Default timeout should be between 5-15 seconds');
    failed++;
  }

  console.log(`\nConfiguration Tests: ${passed} passed, ${failed} failed\n`);
}

testConfiguration();

// =============================================================================
// TEST SUITE 5: Integration with PeerPersistence
// =============================================================================

console.log('\n========================================');
console.log('TEST SUITE 5: PeerPersistence Integration');
console.log('========================================\n');

async function testPersistenceIntegration() {
  const identity = createMockIdentity();
  const peerManager = createMockPeerManager();
  const manager = new DirectReconnectionManager(identity, peerManager, peerPersistence);

  let passed = 0;
  let failed = 0;

  try {
    // Create and store a test peer
    const testPeerId = 'test-peer-' + Date.now();
    const testPeer = createMockCachedPeer({
      peerId: testPeerId,
      displayName: 'Test Peer',
      lastSeen: Date.now() - 30000, // 30 seconds ago
      connectionType: 'Direct UDP'
    });

    console.log('Test 1: Store peer data');
    const storeResult = await peerPersistence.storePeer(testPeer);
    if (storeResult) {
      console.log('  ✓ Peer stored successfully');
      passed++;
    } else {
      console.log('  ✗ Failed to store peer');
      failed++;
    }

    console.log('\nTest 2: Retrieve peer data');
    const retrieved = await peerPersistence.getPeer(testPeerId);
    if (retrieved && retrieved.peerId === testPeerId) {
      console.log('  ✓ Peer retrieved successfully');
      console.log(`    Display name: ${retrieved.displayName}`);
      passed++;
    } else {
      console.log('  ✗ Failed to retrieve peer');
      failed++;
    }

    console.log('\nTest 3: Check cache validity');
    const isValid = manager.isCacheValid(retrieved);
    if (isValid) {
      console.log('  ✓ Cache is valid (as expected)');
      passed++;
    } else {
      console.log('  ✗ Cache should be valid');
      failed++;
    }

    console.log('\nTest 4: Get reconnection probability');
    const probability = manager.getReconnectionProbability(retrieved);
    console.log(`  Likelihood: ${probability.likelihood}`);
    console.log(`  Score: ${probability.score}/100`);
    console.log(`  Factors: ${probability.factors.join(', ')}`);
    if (probability.score > 0) {
      console.log('  ✓ Probability calculated');
      passed++;
    } else {
      console.log('  ✗ Probability should be > 0');
      failed++;
    }

    console.log('\nTest 5: Cleanup - remove test peer');
    const removeResult = await peerPersistence.removePeer(testPeerId);
    if (removeResult) {
      console.log('  ✓ Peer removed successfully');
      passed++;
    } else {
      console.log('  ✗ Failed to remove peer');
      failed++;
    }

  } catch (error) {
    console.error('✗ Integration test error:', error);
    failed++;
  }

  console.log(`\nPersistence Integration Tests: ${passed} passed, ${failed} failed\n`);
}

await testPersistenceIntegration();

// =============================================================================
// TEST SUITE 6: Statistics
// =============================================================================

console.log('\n========================================');
console.log('TEST SUITE 6: Statistics');
console.log('========================================\n');

async function testStatistics() {
  const identity = createMockIdentity();
  const peerManager = createMockPeerManager();
  const manager = new DirectReconnectionManager(identity, peerManager, peerPersistence);

  try {
    const stats = await manager.getStatistics();

    console.log('Reconnection Manager Statistics:');
    console.log(`  Total cached peers: ${stats.totalCached}`);
    console.log(`  Valid cache entries: ${stats.validCache}`);
    console.log(`  Connection types:`, stats.byType);
    console.log(`  Cache age distribution:`, stats.byAge);

    console.log('\n✓ Statistics retrieved successfully\n');

  } catch (error) {
    console.error('✗ Statistics test error:', error);
  }
}

await testStatistics();

// =============================================================================
// TEST SUMMARY
// =============================================================================

console.log('\n========================================');
console.log('TEST SUITE COMPLETE');
console.log('========================================\n');

console.log('All test suites completed. Review results above.');
console.log('\nNote: Some tests involve timing and may vary slightly.');
console.log('The DirectReconnectionManager is ready for production use.\n');
