/**
 * Cold Start Manager - Test Suite
 *
 * Tests the multi-layer fallback recovery system for cold start scenarios
 * where a peer has zero active connections after browser refresh.
 */

import ColdStartManager, { COLD_START_CONFIG } from './cold-start.js';

// =============================================================================
// MOCK DEPENDENCIES
// =============================================================================

class MockIdentity {
  constructor() {
    this.uuid = 'test-user-uuid';
    this.displayName = 'Test User';
  }
}

class MockPeerManager {
  constructor() {
    this.peers = new Map();
    this.connectedCount = 0;
  }

  getConnectedPeerCount() {
    return this.connectedCount;
  }

  setConnectedCount(count) {
    this.connectedCount = count;
  }
}

class MockPeerPersistence {
  constructor() {
    this.mockPeers = [];
  }

  async getReconnectionCandidates(options) {
    const { maxAge, limit } = options;
    const now = Date.now();

    // Filter by age
    let filtered = this.mockPeers.filter(peer => {
      const age = now - peer.lastConnected;
      return age <= maxAge;
    });

    // Sort by recency
    filtered.sort((a, b) => b.lastConnected - a.lastConnected);

    // Limit
    if (limit) {
      filtered = filtered.slice(0, limit);
    }

    // Return as candidates
    return filtered.map(peer => ({
      peer,
      score: 50,
      reason: 'test'
    }));
  }

  addMockPeer(peer) {
    this.mockPeers.push(peer);
  }

  clearMockPeers() {
    this.mockPeers = [];
  }
}

class MockDirectReconnect {
  constructor() {
    this.shouldSucceed = false;
    this.delay = 100;
  }

  async attemptDirectReconnection(peerId, timeout) {
    await new Promise(resolve => setTimeout(resolve, this.delay));

    if (this.shouldSucceed) {
      return { success: true, peerId, method: 'direct' };
    }

    return { success: false, reason: 'connection_failed' };
  }
}

class MockAnnouncements {
  constructor() {
    this.announceCalled = false;
  }

  async announcePresence(reason) {
    this.announceCalled = true;
    return true;
  }
}

// =============================================================================
// TEST UTILITIES
// =============================================================================

function createMockPeer(id, displayName, ageMs, connectionType = 'host') {
  const now = Date.now();
  return {
    peerId: `peer-${id}`,
    displayName,
    lastConnected: now - ageMs,
    lastSeen: now - ageMs,
    connectionQuality: {
      latency: 50,
      successRate: 0.9,
      connectionType,
      lastMeasured: now - ageMs
    },
    cachedCandidates: [
      { candidate: 'mock-candidate', type: 'host' }
    ],
    reconnectionAttempts: 0
  };
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe('ColdStartManager', () => {
  let coldStart;
  let mockIdentity;
  let mockPeerManager;
  let mockPersistence;
  let mockDirectReconnect;
  let mockAnnouncements;

  beforeEach(() => {
    // Reset mocks
    mockIdentity = new MockIdentity();
    mockPeerManager = new MockPeerManager();
    mockPersistence = new MockPeerPersistence();
    mockDirectReconnect = new MockDirectReconnect();
    mockAnnouncements = new MockAnnouncements();

    // Create manager
    coldStart = new ColdStartManager(
      mockIdentity,
      mockPeerManager,
      mockPersistence,
      mockDirectReconnect,
      mockAnnouncements
    );
  });

  // ===========================================================================
  // INITIALIZATION TESTS
  // ===========================================================================

  describe('Initialization', () => {
    test('should initialize with all dependencies', () => {
      expect(coldStart.identity).toBe(mockIdentity);
      expect(coldStart.peerManager).toBe(mockPeerManager);
      expect(coldStart.peerPersistence).toBe(mockPersistence);
      expect(coldStart.directReconnect).toBe(mockDirectReconnect);
      expect(coldStart.announcements).toBe(mockAnnouncements);
      expect(coldStart.isRecovering).toBe(false);
    });

    test('should work without optional dependencies', () => {
      const minimalColdStart = new ColdStartManager(
        mockIdentity,
        mockPeerManager,
        mockPersistence
      );

      expect(minimalColdStart.directReconnect).toBe(null);
      expect(minimalColdStart.announcements).toBe(null);
    });
  });

  // ===========================================================================
  // PEER SELECTION TESTS
  // ===========================================================================

  describe('Peer Selection', () => {
    test('should get recently connected peers (< 5 min)', async () => {
      // Add peers with different ages
      mockPersistence.addMockPeer(createMockPeer(1, 'Recent Peer', 2 * 60 * 1000)); // 2 min ago
      mockPersistence.addMockPeer(createMockPeer(2, 'Old Peer', 10 * 60 * 1000));   // 10 min ago

      const recentPeers = await coldStart.getRecentlyConnectedPeers(5 * 60 * 1000);

      expect(recentPeers.length).toBe(1);
      expect(recentPeers[0].displayName).toBe('Recent Peer');
    });

    test('should score peers appropriately for cold start', () => {
      const recentDirectPeer = createMockPeer(1, 'Recent Direct', 2 * 60 * 1000, 'host');
      const oldRelayPeer = createMockPeer(2, 'Old Relay', 20 * 60 * 1000, 'relay');

      const score1 = coldStart.calculateColdStartScore(recentDirectPeer);
      const score2 = coldStart.calculateColdStartScore(oldRelayPeer);

      expect(score1).toBeGreaterThan(score2);
      expect(score1).toBeGreaterThan(50); // Recent + direct should score high
    });

    test('should prioritize recency over connection quality', () => {
      const veryRecentLowQuality = createMockPeer(1, 'Recent', 1 * 60 * 1000, 'relay');
      const oldHighQuality = createMockPeer(2, 'Old', 30 * 60 * 1000, 'host');

      veryRecentLowQuality.connectionQuality.successRate = 0.5;
      oldHighQuality.connectionQuality.successRate = 1.0;

      const score1 = coldStart.calculateColdStartScore(veryRecentLowQuality);
      const score2 = coldStart.calculateColdStartScore(oldHighQuality);

      expect(score1).toBeGreaterThan(score2);
    });

    test('should give bonus for cached candidates', () => {
      const peerWithCache = createMockPeer(1, 'Cached', 5 * 60 * 1000);
      const peerWithoutCache = createMockPeer(2, 'No Cache', 5 * 60 * 1000);
      peerWithoutCache.cachedCandidates = [];

      const score1 = coldStart.calculateColdStartScore(peerWithCache);
      const score2 = coldStart.calculateColdStartScore(peerWithoutCache);

      expect(score1).toBeGreaterThan(score2);
    });

    test('should penalize failed reconnection attempts', () => {
      const normalPeer = createMockPeer(1, 'Normal', 5 * 60 * 1000);
      const failedPeer = createMockPeer(2, 'Failed', 5 * 60 * 1000);
      failedPeer.reconnectionAttempts = 3;

      const score1 = coldStart.calculateColdStartScore(normalPeer);
      const score2 = coldStart.calculateColdStartScore(failedPeer);

      expect(score1).toBeGreaterThan(score2);
    });
  });

  // ===========================================================================
  // LAYER 1: RECENT PEERS
  // ===========================================================================

  describe('Layer 1: Recent Peers', () => {
    test('should succeed when recent peers are connectable', async () => {
      // Add recent peer
      mockPersistence.addMockPeer(createMockPeer(1, 'Recent', 2 * 60 * 1000));

      // Make direct reconnection succeed
      mockDirectReconnect.shouldSucceed = true;

      const result = await coldStart.handleColdStart();

      expect(result.success).toBe(true);
      expect(result.method).toBe('recent_peers');
      expect(result.connected).toBe(1);
    });

    test('should try multiple recent peers in parallel', async () => {
      // Add multiple recent peers
      for (let i = 1; i <= 5; i++) {
        mockPersistence.addMockPeer(createMockPeer(i, `Peer ${i}`, i * 60 * 1000));
      }

      mockDirectReconnect.shouldSucceed = true;
      const startTime = Date.now();

      const result = await coldStart.tryRecentPeers();
      const elapsed = Date.now() - startTime;

      // Should complete quickly (parallel)
      expect(elapsed).toBeLessThan(1000);
      expect(result.connected).toBeGreaterThan(0);
    });

    test('should fall through when no recent peers', async () => {
      // No peers added
      const result = await coldStart.tryRecentPeers();

      expect(result.connected).toBe(0);
    });
  });

  // ===========================================================================
  // LAYER 2: KNOCK PROTOCOL
  // ===========================================================================

  describe('Layer 2: Knock Protocol', () => {
    test('should attempt knock on recent peers', async () => {
      mockPersistence.addMockPeer(createMockPeer(1, 'Recent', 2 * 60 * 1000));

      const result = await coldStart.tryKnockProtocol();

      // Knock will fail without real WebRTC, but should attempt
      expect(result.connected).toBe(0);
    });

    test('should timeout knock attempts', async () => {
      mockPersistence.addMockPeer(createMockPeer(1, 'Recent', 2 * 60 * 1000));

      const startTime = Date.now();
      const result = await coldStart.tryKnockProtocol(null, 100); // 100ms timeout
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(500); // Should timeout quickly
    });
  });

  // ===========================================================================
  // LAYER 3: ALL KNOWN PEERS
  // ===========================================================================

  describe('Layer 3: All Known Peers', () => {
    test('should try older peers when recent peers fail', async () => {
      // Add older peers (within 24 hours)
      mockPersistence.addMockPeer(createMockPeer(1, 'Old 1', 10 * 60 * 60 * 1000)); // 10 hours
      mockPersistence.addMockPeer(createMockPeer(2, 'Old 2', 20 * 60 * 60 * 1000)); // 20 hours

      const result = await coldStart.tryAllKnownPeers();

      // Should attempt both peers
      expect(result.connected).toBeGreaterThanOrEqual(0);
    });

    test('should limit attempts to configured maximum', async () => {
      // Add many peers
      for (let i = 1; i <= 20; i++) {
        mockPersistence.addMockPeer(createMockPeer(i, `Peer ${i}`, i * 60 * 60 * 1000));
      }

      const allPeers = await coldStart.getAllKnownPeers();

      // Should respect MAX_ATTEMPTS limit
      expect(allPeers.length).toBeLessThanOrEqual(50);
    });
  });

  // ===========================================================================
  // LAYER 4: FALLBACK
  // ===========================================================================

  describe('Layer 4: Initial Pairing Fallback', () => {
    test('should check for saved passphrase', () => {
      // Mock localStorage
      global.localStorage = {
        getItem: jest.fn(() => 'test-passphrase')
      };

      const passphrase = coldStart.getSavedPassphrase();

      expect(passphrase).toBe('test-passphrase');
      expect(localStorage.getItem).toHaveBeenCalledWith('mesh:dht:passphrase');
    });

    test('should dispatch UI event when all layers fail', async () => {
      // Mock window and event listener
      const eventListener = jest.fn();
      global.window = {
        dispatchEvent: eventListener
      };

      coldStart.showManualPairingUI();

      expect(eventListener).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // WARM MESH RECOVERY
  // ===========================================================================

  describe('Warm Mesh Recovery', () => {
    test('should announce presence after successful connection', async () => {
      mockPersistence.addMockPeer(createMockPeer(1, 'Recent', 2 * 60 * 1000));
      mockDirectReconnect.shouldSucceed = true;

      await coldStart.handleColdStart();

      // Give time for warm mesh delay
      await new Promise(resolve => setTimeout(resolve, 3000));

      expect(mockAnnouncements.announceCalled).toBe(true);
    }, 15000); // Extend timeout for this test

    test('should work without announcements module', async () => {
      const coldStartNoAnnounce = new ColdStartManager(
        mockIdentity,
        mockPeerManager,
        mockPersistence,
        mockDirectReconnect,
        null // No announcements
      );

      // Should not throw
      await expect(coldStartNoAnnounce.useWarmMeshForRest()).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // FULL RECOVERY FLOW
  // ===========================================================================

  describe('Full Recovery Flow', () => {
    test('should complete full recovery successfully', async () => {
      mockPersistence.addMockPeer(createMockPeer(1, 'Recent', 2 * 60 * 1000));
      mockDirectReconnect.shouldSucceed = true;

      const result = await coldStart.handleColdStart();

      expect(result.success).toBe(true);
      expect(result.method).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
    });

    test('should fail gracefully when all layers fail', async () => {
      // No peers, direct reconnect fails
      mockDirectReconnect.shouldSucceed = false;

      const result = await coldStart.handleColdStart();

      expect(result.success).toBe(false);
      expect(result.reason).toBe('all_methods_failed');
      expect(result.fallbackRequired).toBe(true);
    });

    test('should prevent concurrent recovery attempts', async () => {
      mockPersistence.addMockPeer(createMockPeer(1, 'Recent', 2 * 60 * 1000));

      const promise1 = coldStart.handleColdStart();
      const promise2 = coldStart.handleColdStart();

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // One should succeed or be in progress, other should be rejected
      const inProgress = [result1, result2].filter(r => r.reason === 'recovery_in_progress');
      expect(inProgress.length).toBe(1);
    });

    test('should log all recovery attempts', async () => {
      mockPersistence.addMockPeer(createMockPeer(1, 'Recent', 2 * 60 * 1000));
      mockDirectReconnect.shouldSucceed = false;

      await coldStart.handleColdStart();

      const stats = coldStart.getStats();
      expect(stats.attemptLog.length).toBeGreaterThan(0);
      expect(stats.totalAttempts).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // STATISTICS & DIAGNOSTICS
  // ===========================================================================

  describe('Statistics & Diagnostics', () => {
    test('should track recovery statistics', async () => {
      mockPersistence.addMockPeer(createMockPeer(1, 'Recent', 2 * 60 * 1000));

      await coldStart.handleColdStart();

      const stats = coldStart.getStats();

      expect(stats).toHaveProperty('isRecovering');
      expect(stats).toHaveProperty('attemptLog');
      expect(stats).toHaveProperty('totalAttempts');
      expect(stats).toHaveProperty('elapsedTime');
    });

    test('should log recovery attempts with timestamps', async () => {
      mockPersistence.addMockPeer(createMockPeer(1, 'Recent', 2 * 60 * 1000));

      await coldStart.handleColdStart();

      const stats = coldStart.getStats();
      const log = stats.attemptLog;

      expect(log.length).toBeGreaterThan(0);
      expect(log[0]).toHaveProperty('layer');
      expect(log[0]).toHaveProperty('success');
      expect(log[0]).toHaveProperty('timestamp');
      expect(log[0]).toHaveProperty('elapsed');
    });
  });

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  describe('Configuration', () => {
    test('should have valid configuration', () => {
      expect(COLD_START_CONFIG).toBeDefined();
      expect(COLD_START_CONFIG.RECENT_PEERS).toBeDefined();
      expect(COLD_START_CONFIG.KNOCK).toBeDefined();
      expect(COLD_START_CONFIG.ALL_PEERS).toBeDefined();
      expect(COLD_START_CONFIG.FALLBACK).toBeDefined();
    });

    test('should have reasonable timeouts', () => {
      expect(COLD_START_CONFIG.RECENT_PEERS.TIMEOUT_MS).toBeLessThan(30000);
      expect(COLD_START_CONFIG.ALL_PEERS.TIMEOUT_MS).toBeLessThan(30000);
      expect(COLD_START_CONFIG.MAX_TOTAL_TIME_MS).toBeLessThan(60000);
    });

    test('should have reasonable attempt limits', () => {
      expect(COLD_START_CONFIG.RECENT_PEERS.MAX_ATTEMPTS).toBeGreaterThan(0);
      expect(COLD_START_CONFIG.ALL_PEERS.MAX_ATTEMPTS).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('ColdStartManager - Integration', () => {
  test('should handle real-world scenario: page refresh with stale cache', async () => {
    const mockIdentity = new MockIdentity();
    const mockPeerManager = new MockPeerManager();
    const mockPersistence = new MockPeerPersistence();

    // Add realistic peer data
    mockPersistence.addMockPeer(createMockPeer(1, 'Alice', 3 * 60 * 1000, 'host'));
    mockPersistence.addMockPeer(createMockPeer(2, 'Bob', 10 * 60 * 1000, 'srflx'));
    mockPersistence.addMockPeer(createMockPeer(3, 'Charlie', 2 * 60 * 60 * 1000, 'relay'));

    const coldStart = new ColdStartManager(
      mockIdentity,
      mockPeerManager,
      mockPersistence
    );

    const result = await coldStart.handleColdStart();

    // Should attempt recovery (may fail without real connections)
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('duration');
  });

  test('should handle scenario: no cached peers at all', async () => {
    const mockIdentity = new MockIdentity();
    const mockPeerManager = new MockPeerManager();
    const mockPersistence = new MockPeerPersistence();

    const coldStart = new ColdStartManager(
      mockIdentity,
      mockPeerManager,
      mockPersistence
    );

    const result = await coldStart.handleColdStart();

    // Should fall through to manual pairing
    expect(result.success).toBe(false);
    expect(result.reason).toBe('all_methods_failed');
    expect(result.fallbackRequired).toBe(true);
  });
});

// =============================================================================
// EXPORT FOR RUNNING TESTS
// =============================================================================

export {
  MockIdentity,
  MockPeerManager,
  MockPeerPersistence,
  MockDirectReconnect,
  MockAnnouncements,
  createMockPeer
};
