/**
 * Test suite for peer-persistence module
 *
 * Run these tests to verify the implementation works correctly.
 * Can be used with any test framework (Jest, Mocha, etc.)
 */

import peerPersistence, { createPeerData, updateQualityMetrics } from './peer-persistence.js';

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a mock peer for testing
 */
function createMockPeer(overrides = {}) {
  return createPeerData({
    peerId: `PEER${Math.random().toString(36).substring(7).toUpperCase()}`,
    userId: `user-${Date.now()}`,
    displayName: `Test User ${Math.random().toString(36).substring(7)}`,
    publicKey: JSON.stringify({
      kty: 'EC',
      crv: 'P-256',
      x: 'mock-x-value',
      y: 'mock-y-value',
    }),
    sharedSecret: 'mock-shared-secret',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
    ],
    ...overrides,
  });
}

/**
 * Clear test data
 */
async function clearTestData() {
  await peerPersistence.clearAll();
}

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// =============================================================================
// UNIT TESTS
// =============================================================================

/**
 * Test: Initialize storage
 */
async function testInitialize() {
  console.log('Test: Initialize storage');

  await peerPersistence.initialize();
  const stats = await peerPersistence.getStorageStats();

  assert(stats !== null, 'Storage stats should not be null');
  assert(stats.peerCount >= 0, 'Peer count should be >= 0');

  console.log('✓ Initialize storage');
}

/**
 * Test: Store and retrieve peer
 */
async function testStorePeer() {
  console.log('Test: Store and retrieve peer');

  await clearTestData();

  const mockPeer = createMockPeer();
  const stored = await peerPersistence.storePeer(mockPeer);

  assert(stored === true, 'storePeer should return true');

  const retrieved = await peerPersistence.getPeer(mockPeer.peerId);

  assert(retrieved !== null, 'Retrieved peer should not be null');
  assert(retrieved.peerId === mockPeer.peerId, 'Peer IDs should match');
  assert(retrieved.displayName === mockPeer.displayName, 'Display names should match');
  assert(retrieved.sharedSecret === mockPeer.sharedSecret, 'Shared secrets should match (decrypted)');

  console.log('✓ Store and retrieve peer');
}

/**
 * Test: Remove peer
 */
async function testRemovePeer() {
  console.log('Test: Remove peer');

  await clearTestData();

  const mockPeer = createMockPeer();
  await peerPersistence.storePeer(mockPeer);

  const removed = await peerPersistence.removePeer(mockPeer.peerId);
  assert(removed === true, 'removePeer should return true');

  const retrieved = await peerPersistence.getPeer(mockPeer.peerId);
  assert(retrieved === null, 'Removed peer should not be retrievable');

  console.log('✓ Remove peer');
}

/**
 * Test: Query peers by recency
 */
async function testQueryByRecency() {
  console.log('Test: Query peers by recency');

  await clearTestData();

  // Create 5 peers with different timestamps
  const peers = [];
  for (let i = 0; i < 5; i++) {
    const peer = createMockPeer({
      lastSeen: Date.now() - (i * 60 * 60 * 1000), // Each 1 hour apart
    });
    peers.push(peer);
    await peerPersistence.storePeer(peer);
  }

  // Query most recent first
  const results = await peerPersistence.queryPeers({
    sortBy: 'lastSeen',
    order: 'desc',
    limit: 3,
  });

  assert(results.length === 3, 'Should return 3 peers');
  assert(results[0].peerId === peers[0].peerId, 'Most recent peer should be first');
  assert(results[1].lastSeen < results[0].lastSeen, 'Should be sorted by lastSeen descending');

  console.log('✓ Query peers by recency');
}

/**
 * Test: Query peers by quality
 */
async function testQueryByQuality() {
  console.log('Test: Query peers by quality');

  await clearTestData();

  // Create peers with different quality metrics
  const highQualityPeer = createMockPeer({
    connectionQuality: {
      latency: 50,
      successRate: 0.95,
      connectionType: 'host',
      totalConnections: 10,
      successfulConnections: 9,
      avgUptime: 600,
    },
  });

  const lowQualityPeer = createMockPeer({
    connectionQuality: {
      latency: 800,
      successRate: 0.5,
      connectionType: 'relay',
      totalConnections: 10,
      successfulConnections: 5,
      avgUptime: 60,
    },
  });

  await peerPersistence.storePeer(highQualityPeer);
  await peerPersistence.storePeer(lowQualityPeer);

  // Query by quality
  const results = await peerPersistence.queryPeers({
    sortBy: 'quality',
    order: 'desc',
  });

  assert(results.length === 2, 'Should return 2 peers');
  assert(results[0].peerId === highQualityPeer.peerId, 'High quality peer should be first');
  assert(results[0]._qualityScore > results[1]._qualityScore, 'Should be sorted by quality');

  console.log('✓ Query peers by quality');
}

/**
 * Test: Get reconnection candidates
 */
async function testReconnectionCandidates() {
  console.log('Test: Get reconnection candidates');

  await clearTestData();

  // Create peers with varying characteristics
  const recentHighQuality = createMockPeer({
    lastSeen: Date.now() - (1 * 60 * 60 * 1000), // 1 hour ago
    connectionQuality: {
      latency: 50,
      successRate: 0.9,
      connectionType: 'host',
      totalConnections: 5,
      successfulConnections: 4,
      avgUptime: 500,
    },
  });

  const oldLowQuality = createMockPeer({
    lastSeen: Date.now() - (10 * 24 * 60 * 60 * 1000), // 10 days ago
    connectionQuality: {
      latency: 500,
      successRate: 0.5,
      connectionType: 'relay',
      totalConnections: 2,
      successfulConnections: 1,
      avgUptime: 100,
    },
  });

  await peerPersistence.storePeer(recentHighQuality);
  await peerPersistence.storePeer(oldLowQuality);

  const candidates = await peerPersistence.getReconnectionCandidates({
    limit: 2,
  });

  assert(candidates.length === 2, 'Should return 2 candidates');
  assert(candidates[0].peer.peerId === recentHighQuality.peerId, 'Recent high-quality peer should be first');
  assert(candidates[0].score > candidates[1].score, 'Should be sorted by reconnection score');

  console.log('✓ Get reconnection candidates');
}

/**
 * Test: Update connection quality
 */
async function testUpdateConnectionQuality() {
  console.log('Test: Update connection quality');

  await clearTestData();

  const mockPeer = createMockPeer();
  await peerPersistence.storePeer(mockPeer);

  // Update quality
  const updated = await peerPersistence.updateConnectionQuality(mockPeer.peerId, {
    latency: 100,
    connectionType: 'srflx',
  });

  assert(updated === true, 'updateConnectionQuality should return true');

  const retrieved = await peerPersistence.getPeer(mockPeer.peerId);
  assert(retrieved.connectionQuality.latency === 100, 'Latency should be updated');
  assert(retrieved.connectionQuality.connectionType === 'srflx', 'Connection type should be updated');
  assert(retrieved.reconnectionAttempts === 0, 'Reconnection attempts should be reset');

  console.log('✓ Update connection quality');
}

/**
 * Test: Increment reconnection attempts and blacklist
 */
async function testReconnectionAttempts() {
  console.log('Test: Increment reconnection attempts and blacklist');

  await clearTestData();

  const mockPeer = createMockPeer();
  await peerPersistence.storePeer(mockPeer);

  // Increment attempts
  for (let i = 0; i < 6; i++) {
    await peerPersistence.incrementReconnectionAttempts(mockPeer.peerId);
  }

  const retrieved = await peerPersistence.getPeer(mockPeer.peerId);
  assert(retrieved.reconnectionAttempts === 6, 'Reconnection attempts should be 6');
  assert(retrieved.blacklistUntil !== null, 'Peer should be blacklisted');
  assert(retrieved.blacklistUntil > Date.now(), 'Blacklist should be in future');

  console.log('✓ Increment reconnection attempts and blacklist');
}

/**
 * Test: Cleanup stale peers
 */
async function testCleanupStalePeers() {
  console.log('Test: Cleanup stale peers');

  await clearTestData();

  // Create old peer
  const oldPeer = createMockPeer({
    lastSeen: Date.now() - (31 * 24 * 60 * 60 * 1000), // 31 days ago
  });

  // Create recent peer
  const recentPeer = createMockPeer({
    lastSeen: Date.now() - (1 * 24 * 60 * 60 * 1000), // 1 day ago
  });

  await peerPersistence.storePeer(oldPeer);
  await peerPersistence.storePeer(recentPeer);

  // Run cleanup
  const removed = await peerPersistence.cleanupStalePeers();

  assert(removed === 1, 'Should remove 1 stale peer');

  const oldRetrieved = await peerPersistence.getPeer(oldPeer.peerId);
  const recentRetrieved = await peerPersistence.getPeer(recentPeer.peerId);

  assert(oldRetrieved === null, 'Old peer should be removed');
  assert(recentRetrieved !== null, 'Recent peer should remain');

  console.log('✓ Cleanup stale peers');
}

/**
 * Test: LRU cleanup
 */
async function testCleanupLRU() {
  console.log('Test: LRU cleanup');

  await clearTestData();

  // Create 10 peers
  const peers = [];
  for (let i = 0; i < 10; i++) {
    const peer = createMockPeer({
      lastSeen: Date.now() - (i * 60 * 60 * 1000),
    });
    peers.push(peer);
    await peerPersistence.storePeer(peer);
  }

  // Keep only 5 most recent
  const removed = await peerPersistence.cleanupLRU(5);

  assert(removed === 5, 'Should remove 5 peers');

  const stats = await peerPersistence.getStorageStats();
  assert(stats.peerCount === 5, 'Should have 5 peers remaining');

  console.log('✓ LRU cleanup');
}

/**
 * Test: Storage stats
 */
async function testStorageStats() {
  console.log('Test: Storage stats');

  await clearTestData();

  // Add some peers
  for (let i = 0; i < 3; i++) {
    await peerPersistence.storePeer(createMockPeer());
  }

  const stats = await peerPersistence.getStorageStats();

  assert(stats.peerCount === 3, 'Should have 3 peers');
  assert(stats.estimatedSizeBytes > 0, 'Should have non-zero size');
  assert(parseFloat(stats.estimatedSizeMB) > 0, 'Should have non-zero MB');
  assert(parseFloat(stats.utilizationPercent) > 0, 'Should have non-zero utilization');

  console.log('✓ Storage stats');
}

/**
 * Test: Export and import data
 */
async function testExportImport() {
  console.log('Test: Export and import data');

  await clearTestData();

  // Create and store peers
  const peers = [];
  for (let i = 0; i < 3; i++) {
    const peer = createMockPeer();
    peers.push(peer);
    await peerPersistence.storePeer(peer);
  }

  // Export
  const exported = await peerPersistence.exportData();

  assert(exported.peers.length === 3, 'Should export 3 peers');
  assert(exported.version !== undefined, 'Should have version');
  assert(exported.exportDate !== undefined, 'Should have export date');

  // Clear and import
  await clearTestData();

  const imported = await peerPersistence.importData(exported);

  assert(imported === 3, 'Should import 3 peers');

  const stats = await peerPersistence.getStorageStats();
  assert(stats.peerCount === 3, 'Should have 3 peers after import');

  console.log('✓ Export and import data');
}

/**
 * Test: Update quality metrics helper
 */
async function testUpdateQualityMetrics() {
  console.log('Test: Update quality metrics helper');

  const current = {
    latency: 100,
    successRate: 0.8,
    connectionType: 'host',
    lastMeasured: Date.now(),
    totalConnections: 5,
    successfulConnections: 4,
    avgUptime: 300,
  };

  // Update with new latency
  const updated = updateQualityMetrics(current, {
    latency: 150,
    success: true,
    uptime: 400,
  });

  assert(updated.latency !== 100, 'Latency should be updated');
  assert(updated.latency > 100 && updated.latency < 150, 'Latency should be moving average');
  assert(updated.totalConnections === 6, 'Total connections should increment');
  assert(updated.successfulConnections === 5, 'Successful connections should increment');
  assert(updated.successRate > 0.8, 'Success rate should increase');

  console.log('✓ Update quality metrics helper');
}

/**
 * Test: Calculate quality score
 */
async function testCalculateQualityScore() {
  console.log('Test: Calculate quality score');

  const highQualityPeer = createMockPeer({
    connectionQuality: {
      latency: 30,
      successRate: 1.0,
      connectionType: 'host',
      totalConnections: 10,
      successfulConnections: 10,
      avgUptime: 1000,
    },
  });

  const lowQualityPeer = createMockPeer({
    connectionQuality: {
      latency: 900,
      successRate: 0.4,
      connectionType: 'relay',
      totalConnections: 10,
      successfulConnections: 4,
      avgUptime: 30,
    },
  });

  const highScore = peerPersistence.calculateQualityScore(highQualityPeer);
  const lowScore = peerPersistence.calculateQualityScore(lowQualityPeer);

  assert(highScore > lowScore, 'High quality peer should have higher score');
  assert(highScore >= 80, 'High quality peer should have score >= 80');
  assert(lowScore <= 30, 'Low quality peer should have score <= 30');

  console.log(`✓ Calculate quality score (high: ${highScore}, low: ${lowScore})`);
}

/**
 * Test: Encryption/decryption
 */
async function testEncryption() {
  console.log('Test: Encryption/decryption');

  await clearTestData();

  const mockPeer = createMockPeer({
    sharedSecret: 'super-secret-password-12345',
  });

  // Store (should encrypt)
  await peerPersistence.storePeer(mockPeer);

  // Retrieve (should decrypt)
  const retrieved = await peerPersistence.getPeer(mockPeer.peerId);

  assert(retrieved.sharedSecret === mockPeer.sharedSecret, 'Shared secret should match after encryption/decryption');

  // Check that it's actually encrypted in storage
  const stored = localStorage.getItem(`mesh:peer:${mockPeer.peerId}`);
  const parsed = JSON.parse(stored);

  assert(parsed.encryptedSecret !== undefined, 'Should have encrypted secret in storage');
  assert(parsed.encryptedSecret !== mockPeer.sharedSecret, 'Encrypted secret should not match plaintext');
  assert(parsed.sharedSecret === undefined, 'Should not have plaintext secret in storage');

  console.log('✓ Encryption/decryption');
}

/**
 * Test: Blacklist management
 */
async function testBlacklistManagement() {
  console.log('Test: Blacklist management');

  await clearTestData();

  // Create blacklisted peer
  const blacklistedPeer = createMockPeer({
    reconnectionAttempts: 10,
    blacklistUntil: Date.now() + (24 * 60 * 60 * 1000), // 24 hours from now
  });

  // Create normal peer
  const normalPeer = createMockPeer();

  await peerPersistence.storePeer(blacklistedPeer);
  await peerPersistence.storePeer(normalPeer);

  // Query with blacklist filter
  const results = await peerPersistence.queryPeers({
    excludeBlacklisted: true,
  });

  assert(results.length === 1, 'Should return only 1 non-blacklisted peer');
  assert(results[0].peerId === normalPeer.peerId, 'Should return the normal peer');

  // Clear expired blacklists (none should be cleared)
  const cleared = await peerPersistence.clearExpiredBlacklists();
  assert(cleared === 0, 'Should not clear unexpired blacklists');

  console.log('✓ Blacklist management');
}

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

/**
 * Integration test: Full reconnection workflow
 */
async function testReconnectionWorkflow() {
  console.log('Integration: Full reconnection workflow');

  await clearTestData();

  // Step 1: Connect to peer and store
  const peer = createMockPeer({
    connectionQuality: {
      latency: 80,
      successRate: 1.0,
      connectionType: 'srflx',
      totalConnections: 1,
      successfulConnections: 1,
      avgUptime: 0,
    },
  });

  await peerPersistence.storePeer(peer);
  console.log('  - Stored peer');

  // Step 2: Update quality during connection
  await peerPersistence.updateConnectionQuality(peer.peerId, {
    latency: 70,
  });
  console.log('  - Updated quality');

  // Step 3: Connection closes
  const retrieved = await peerPersistence.getPeer(peer.peerId);
  const updatedQuality = updateQualityMetrics(retrieved.connectionQuality, {
    uptime: 600,
    success: true,
  });
  await peerPersistence.updateConnectionQuality(peer.peerId, updatedQuality);
  console.log('  - Recorded uptime');

  // Step 4: Page refresh - get reconnection candidates
  const candidates = await peerPersistence.getReconnectionCandidates({ limit: 5 });

  assert(candidates.length === 1, 'Should have 1 reconnection candidate');
  assert(candidates[0].peer.peerId === peer.peerId, 'Should be our peer');
  assert(candidates[0].score > 50, 'Should have good reconnection score');

  console.log(`  - Got reconnection candidate (score: ${candidates[0].score})`);

  console.log('✓ Full reconnection workflow');
}

/**
 * Integration test: Cleanup workflow
 */
async function testCleanupWorkflow() {
  console.log('Integration: Cleanup workflow');

  await clearTestData();

  // Create various peers
  const peers = {
    stale: createMockPeer({
      lastSeen: Date.now() - (31 * 24 * 60 * 60 * 1000), // 31 days
    }),
    blacklisted: createMockPeer({
      reconnectionAttempts: 10,
      blacklistUntil: Date.now() - (1000), // Expired
    }),
    active: createMockPeer({
      lastSeen: Date.now() - (1 * 60 * 60 * 1000), // 1 hour
    }),
  };

  for (const peer of Object.values(peers)) {
    await peerPersistence.storePeer(peer);
  }

  console.log('  - Created test peers');

  // Run cleanup
  const removed = await peerPersistence.cleanupStalePeers();
  console.log(`  - Cleanup removed ${removed} peers`);

  // Verify results
  const staleRetrieved = await peerPersistence.getPeer(peers.stale.peerId);
  const blacklistedRetrieved = await peerPersistence.getPeer(peers.blacklisted.peerId);
  const activeRetrieved = await peerPersistence.getPeer(peers.active.peerId);

  assert(staleRetrieved === null, 'Stale peer should be removed');
  assert(blacklistedRetrieved === null, 'Blacklisted peer should be removed');
  assert(activeRetrieved !== null, 'Active peer should remain');

  console.log('✓ Cleanup workflow');
}

// =============================================================================
// PERFORMANCE TESTS
// =============================================================================

/**
 * Performance test: Store many peers
 */
async function testStoreManyPeers() {
  console.log('Performance: Store many peers');

  await clearTestData();

  const count = 100;
  const startTime = performance.now();

  for (let i = 0; i < count; i++) {
    await peerPersistence.storePeer(createMockPeer());
  }

  const endTime = performance.now();
  const avgTime = (endTime - startTime) / count;

  console.log(`  - Stored ${count} peers in ${(endTime - startTime).toFixed(2)}ms`);
  console.log(`  - Average: ${avgTime.toFixed(2)}ms per peer`);

  const stats = await peerPersistence.getStorageStats();
  console.log(`  - Total size: ${stats.estimatedSizeMB} MB`);

  console.log('✓ Store many peers');
}

/**
 * Performance test: Query with sorting
 */
async function testQueryPerformance() {
  console.log('Performance: Query with sorting');

  await clearTestData();

  // Create 50 peers
  for (let i = 0; i < 50; i++) {
    await peerPersistence.storePeer(createMockPeer());
  }

  const startTime = performance.now();

  const results = await peerPersistence.queryPeers({
    sortBy: 'quality',
    order: 'desc',
    limit: 10,
  });

  const endTime = performance.now();

  console.log(`  - Queried 50 peers in ${(endTime - startTime).toFixed(2)}ms`);
  console.log(`  - Returned ${results.length} results`);

  console.log('✓ Query performance');
}

// =============================================================================
// TEST RUNNER
// =============================================================================

/**
 * Run all tests
 */
export async function runAllTests() {
  console.log('='.repeat(60));
  console.log('RUNNING PEER PERSISTENCE TESTS');
  console.log('='.repeat(60));

  const tests = [
    // Unit tests
    testInitialize,
    testStorePeer,
    testRemovePeer,
    testQueryByRecency,
    testQueryByQuality,
    testReconnectionCandidates,
    testUpdateConnectionQuality,
    testReconnectionAttempts,
    testCleanupStalePeers,
    testCleanupLRU,
    testStorageStats,
    testExportImport,
    testUpdateQualityMetrics,
    testCalculateQualityScore,
    testEncryption,
    testBlacklistManagement,

    // Integration tests
    testReconnectionWorkflow,
    testCleanupWorkflow,

    // Performance tests
    testStoreManyPeers,
    testQueryPerformance,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (error) {
      console.error(`✗ ${test.name} FAILED:`, error.message);
      failed++;
    }
  }

  console.log('='.repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  // Cleanup
  await clearTestData();

  return { passed, failed };
}

// Run tests if this file is executed directly
if (typeof window !== 'undefined' && window.location.search.includes('run-tests')) {
  runAllTests();
}

export {
  createMockPeer,
  clearTestData,
  assert,
};
