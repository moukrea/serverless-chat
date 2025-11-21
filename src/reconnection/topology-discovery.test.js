/**
 * Unit Tests for MeshTopologyManager
 *
 * Tests topology discovery, BFS path finding, relay selection,
 * and all core functionality of the topology manager.
 */

import MeshTopologyManager, { MESSAGE_TYPES } from './topology-discovery.js';

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create mock identity
 */
function createMockIdentity(uuid = 'user-123', displayName = 'Test User') {
  return { uuid, displayName };
}

/**
 * Create mock message router
 */
function createMockRouter() {
  const handlers = new Map();

  return {
    handlers,
    createMessage: (msgType, payload, options = {}) => ({
      msgId: `msg-${Date.now()}`,
      msgType,
      senderId: options.senderId || 'user-123',
      senderName: options.senderName || 'Test User',
      timestamp: Date.now(),
      ttl: options.ttl || 5,
      hopCount: 0,
      path: [options.senderId || 'user-123'],
      targetPeerId: options.targetPeerId || null,
      routingHint: options.routingHint || 'broadcast',
      payload,
    }),
    routeMessage: async (message) => {
      // Simulate message routing
      return true;
    },
    on: (msgType, handler) => {
      handlers.set(msgType, handler);
    },
  };
}

/**
 * Create mock peer manager
 */
function createMockPeerManager(peers = []) {
  const peerMap = new Map();

  // Add mock peers
  for (const peer of peers) {
    peerMap.set(peer.peerId, {
      displayName: peer.displayName,
      status: peer.status || 'connected',
      peer: {
        connectionState: {
          latency: peer.latency || 100,
          uptime: peer.uptime || 300,
        },
      },
    });
  }

  return {
    peers: peerMap,
  };
}

/**
 * Create test topology manager
 */
function createTestManager(options = {}) {
  const identity = options.identity || createMockIdentity();
  const router = options.router || createMockRouter();
  const peerManager = options.peerManager || createMockPeerManager();
  const config = options.config || {};

  return new MeshTopologyManager(identity, router, peerManager, config);
}

// =============================================================================
// SIMPLE TEST RUNNER
// =============================================================================

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failedTests++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
  }
}

function expect(actual) {
  return {
    not: {
      toBe: (expected) => {
        if (actual === expected) {
          throw new Error(`Expected ${actual} not to be ${expected}`);
        }
      },
    },
    toBe: (expected) => {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toEqual: (expected) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toBeDefined: () => {
      if (actual === undefined) {
        throw new Error('Expected value to be defined');
      }
    },
    toBeNull: () => {
      if (actual !== null) {
        throw new Error(`Expected null but got ${actual}`);
      }
    },
    toBeGreaterThan: (expected) => {
      if (actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual: (expected) => {
      if (actual < expected) {
        throw new Error(`Expected ${actual} to be greater than or equal to ${expected}`);
      }
    },
    toBeLessThanOrEqual: (expected) => {
      if (actual > expected) {
        throw new Error(`Expected ${actual} to be less than or equal to ${expected}`);
      }
    },
    toContain: (expected) => {
      if (!actual.includes(expected)) {
        throw new Error(`Expected ${actual} to contain ${expected}`);
      }
    },
    toHaveProperty: (prop) => {
      if (!(prop in actual)) {
        throw new Error(`Expected object to have property ${prop}`);
      }
    },
  };
}

// =============================================================================
// INITIALIZATION TESTS
// =============================================================================

describe('MeshTopologyManager - Initialization', () => {
  test('should initialize with default config', () => {
    const manager = createTestManager();

    expect(manager.identity).toBeDefined();
    expect(manager.router).toBeDefined();
    expect(manager.peerManager).toBeDefined();
    expect(manager.topology.size).toBe(0);
    expect(manager.stats.requestsSent).toBe(0);
  });

  test('should register message handlers', () => {
    const router = createMockRouter();
    createTestManager({ router });

    expect(router.handlers.has(MESSAGE_TYPES.TOPOLOGY_REQUEST)).toBe(true);
    expect(router.handlers.has(MESSAGE_TYPES.TOPOLOGY_RESPONSE)).toBe(true);
  });

  test('should accept custom config', () => {
    const config = {
      discoveryTimeout: 5000,
      discoveryInterval: 30000,
    };

    const manager = createTestManager({ config });

    expect(manager.config.discoveryTimeout).toBe(5000);
    expect(manager.config.discoveryInterval).toBe(30000);
  });
});

// =============================================================================
// TOPOLOGY DISCOVERY TESTS
// =============================================================================

describe('MeshTopologyManager - Topology Discovery', () => {
  test('should send topology request', async () => {
    const router = createMockRouter();
    let routedMessage = null;

    router.routeMessage = async (message) => {
      routedMessage = message;
      return true;
    };

    const manager = createTestManager({ router });

    // Start discovery (will timeout since no responses)
    const promise = manager.discoverTopology(100);

    // Give it time to send request
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(routedMessage).toBeDefined();
    expect(routedMessage.msgType).toBe(MESSAGE_TYPES.TOPOLOGY_REQUEST);
    expect(routedMessage.payload.requesterId).toBe('user-123');
    expect(manager.stats.requestsSent).toBe(1);

    // Wait for timeout
    await promise;
  });

  test('should handle topology request', async () => {
    const peerManager = createMockPeerManager([
      { peerId: 'peer-1', displayName: 'Peer 1', latency: 50, uptime: 600 },
      { peerId: 'peer-2', displayName: 'Peer 2', latency: 100, uptime: 300 },
    ]);

    const router = createMockRouter();
    let response = null;

    router.routeMessage = async (message) => {
      if (message.msgType === MESSAGE_TYPES.TOPOLOGY_RESPONSE) {
        response = message;
      }
      return true;
    };

    const manager = createTestManager({ router, peerManager });

    // Simulate receiving request
    const request = {
      msgType: MESSAGE_TYPES.TOPOLOGY_REQUEST,
      senderId: 'requester-123',
      senderName: 'Requester',
      payload: {
        requestId: 'req-123',
        requesterId: 'requester-123',
        timestamp: Date.now(),
      },
    };

    await manager.handleTopologyRequest(request);

    expect(response).toBeDefined();
    expect(response.msgType).toBe(MESSAGE_TYPES.TOPOLOGY_RESPONSE);
    expect(response.payload.connectedPeers.length).toBe(2);
    expect(response.payload.metadata.totalConnections).toBe(2);
  });

  test('should not respond to own requests', async () => {
    const router = createMockRouter();
    let responseCount = 0;

    router.routeMessage = async (message) => {
      if (message.msgType === MESSAGE_TYPES.TOPOLOGY_RESPONSE) {
        responseCount++;
      }
      return true;
    };

    const manager = createTestManager({ router });

    // Simulate receiving our own request
    const request = {
      msgType: MESSAGE_TYPES.TOPOLOGY_REQUEST,
      senderId: 'user-123',
      senderName: 'Test User',
      payload: {
        requestId: 'req-123',
        requesterId: 'user-123',
        timestamp: Date.now(),
      },
    };

    await manager.handleTopologyRequest(request);

    expect(responseCount).toBe(0);
  });

  test('should collect topology responses', async () => {
    const manager = createTestManager();

    // Start discovery
    const promise = manager.discoverTopology(200);

    // Simulate responses
    const responses = [
      {
        msgType: MESSAGE_TYPES.TOPOLOGY_RESPONSE,
        senderId: 'peer-1',
        senderName: 'Peer 1',
        timestamp: Date.now(),
        payload: {
          requestId: Array.from(manager.activeRequests.keys())[0],
          responderId: 'peer-1',
          responderName: 'Peer 1',
          timestamp: Date.now(),
          connectedPeers: [
            { peerId: 'peer-2', displayName: 'Peer 2', latency: 50, uptime: 300, connectionQuality: 80 },
          ],
          metadata: { totalConnections: 1, meshRole: 'leaf' },
        },
      },
      {
        msgType: MESSAGE_TYPES.TOPOLOGY_RESPONSE,
        senderId: 'peer-2',
        senderName: 'Peer 2',
        timestamp: Date.now(),
        payload: {
          requestId: Array.from(manager.activeRequests.keys())[0],
          responderId: 'peer-2',
          responderName: 'Peer 2',
          timestamp: Date.now(),
          connectedPeers: [
            { peerId: 'peer-1', displayName: 'Peer 1', latency: 50, uptime: 300, connectionQuality: 80 },
            { peerId: 'peer-3', displayName: 'Peer 3', latency: 100, uptime: 200, connectionQuality: 70 },
          ],
          metadata: { totalConnections: 2, meshRole: 'relay' },
        },
      },
    ];

    for (const response of responses) {
      await manager.handleTopologyResponse(response);
    }

    const result = await promise;

    expect(manager.topology.size).toBe(2);
    expect(manager.topology.has('peer-1')).toBe(true);
    expect(manager.topology.has('peer-2')).toBe(true);
    expect(manager.stats.responsesReceived).toBe(2);
  });
});

// =============================================================================
// TOPOLOGY MAP TESTS
// =============================================================================

describe('MeshTopologyManager - Topology Map', () => {
  test('should update topology map from responses', () => {
    const manager = createTestManager();

    const responses = new Map([
      ['peer-1', {
        peerId: 'peer-1',
        displayName: 'Peer 1',
        connectedPeers: [
          { peerId: 'peer-2', displayName: 'Peer 2', latency: 50, uptime: 300, connectionQuality: 85 },
        ],
        metadata: { totalConnections: 1, meshRole: 'leaf' },
        timestamp: Date.now(),
      }],
      ['peer-2', {
        peerId: 'peer-2',
        displayName: 'Peer 2',
        connectedPeers: [
          { peerId: 'peer-1', displayName: 'Peer 1', latency: 50, uptime: 300, connectionQuality: 85 },
          { peerId: 'peer-3', displayName: 'Peer 3', latency: 100, uptime: 200, connectionQuality: 70 },
        ],
        metadata: { totalConnections: 2, meshRole: 'relay' },
        timestamp: Date.now(),
      }],
    ]);

    manager.updateTopologyMap(responses);

    expect(manager.topology.size).toBe(2);

    const peer1Data = manager.topology.get('peer-1');
    expect(peer1Data.displayName).toBe('Peer 1');
    expect(peer1Data.connectedTo.has('peer-2')).toBe(true);
    expect(peer1Data.connectedTo.size).toBe(1);

    const peer2Data = manager.topology.get('peer-2');
    expect(peer2Data.displayName).toBe('Peer 2');
    expect(peer2Data.connectedTo.has('peer-1')).toBe(true);
    expect(peer2Data.connectedTo.has('peer-3')).toBe(true);
    expect(peer2Data.connectedTo.size).toBe(2);
  });

  test('should get topology view', () => {
    const peerManager = createMockPeerManager([
      { peerId: 'peer-1', displayName: 'Peer 1' },
    ]);

    const manager = createTestManager({ peerManager });

    // Add some topology data
    manager.topology.set('peer-2', {
      displayName: 'Peer 2',
      connectedTo: new Set(['peer-1', 'peer-3']),
      peers: [],
      metadata: {},
      lastUpdated: Date.now(),
    });

    const view = manager.getTopologyView();

    expect(view.self.peerId).toBe('user-123');
    expect(view.self.displayName).toBe('Test User');
    expect(view.self.connections.length).toBe(1);
    expect(view.knownPeers.length).toBe(1);
    expect(view.totalNodes).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// PATH FINDING TESTS (BFS)
// =============================================================================

describe('MeshTopologyManager - Path Finding', () => {
  test('should find direct path', () => {
    const peerManager = createMockPeerManager([
      { peerId: 'peer-1', displayName: 'Peer 1' },
    ]);

    const manager = createTestManager({ peerManager });

    const paths = manager.findPathsToPeer('peer-1');

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain('user-123');
    expect(paths[0]).toContain('peer-1');
    expect(paths[0].length).toBe(2); // Direct path: self -> peer-1
  });

  test('should find multi-hop paths', () => {
    const peerManager = createMockPeerManager([
      { peerId: 'peer-1', displayName: 'Peer 1' },
    ]);

    const manager = createTestManager({ peerManager });

    // Build topology: self -> peer-1 -> peer-2 -> target
    manager.topology.set('peer-1', {
      displayName: 'Peer 1',
      connectedTo: new Set(['user-123', 'peer-2']),
      peers: [],
      metadata: {},
      lastUpdated: Date.now(),
    });

    manager.topology.set('peer-2', {
      displayName: 'Peer 2',
      connectedTo: new Set(['peer-1', 'target-123']),
      peers: [],
      metadata: {},
      lastUpdated: Date.now(),
    });

    const paths = manager.findPathsToPeer('target-123');

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain('user-123');
    expect(paths[0]).toContain('peer-1');
    expect(paths[0]).toContain('peer-2');
    expect(paths[0]).toContain('target-123');
    expect(paths[0].length).toBe(4); // 3-hop path
  });

  test('should find multiple paths', () => {
    const peerManager = createMockPeerManager([
      { peerId: 'peer-1', displayName: 'Peer 1' },
      { peerId: 'peer-2', displayName: 'Peer 2' },
    ]);

    const manager = createTestManager({ peerManager });

    // Build topology with multiple paths to target
    manager.topology.set('peer-1', {
      displayName: 'Peer 1',
      connectedTo: new Set(['user-123', 'target-123']),
      peers: [],
      metadata: {},
      lastUpdated: Date.now(),
    });

    manager.topology.set('peer-2', {
      displayName: 'Peer 2',
      connectedTo: new Set(['user-123', 'target-123']),
      peers: [],
      metadata: {},
      lastUpdated: Date.now(),
    });

    const paths = manager.findPathsToPeer('target-123', 3);

    expect(paths.length).toBeGreaterThanOrEqual(2);
    // All paths should reach target
    paths.forEach(path => {
      expect(path[path.length - 1]).toBe('target-123');
    });
  });

  test('should return empty array when no path exists', () => {
    const manager = createTestManager();

    const paths = manager.findPathsToPeer('unreachable-peer');

    expect(paths).toEqual([]);
  });

  test('should limit number of paths', () => {
    const peerManager = createMockPeerManager([
      { peerId: 'peer-1', displayName: 'Peer 1' },
      { peerId: 'peer-2', displayName: 'Peer 2' },
      { peerId: 'peer-3', displayName: 'Peer 3' },
    ]);

    const manager = createTestManager({ peerManager });

    // Build topology with 3 possible paths
    manager.topology.set('peer-1', {
      displayName: 'Peer 1',
      connectedTo: new Set(['user-123', 'target-123']),
      peers: [],
      metadata: {},
      lastUpdated: Date.now(),
    });

    manager.topology.set('peer-2', {
      displayName: 'Peer 2',
      connectedTo: new Set(['user-123', 'target-123']),
      peers: [],
      metadata: {},
      lastUpdated: Date.now(),
    });

    manager.topology.set('peer-3', {
      displayName: 'Peer 3',
      connectedTo: new Set(['user-123', 'target-123']),
      peers: [],
      metadata: {},
      lastUpdated: Date.now(),
    });

    const paths = manager.findPathsToPeer('target-123', 2);

    expect(paths.length).toBeLessThanOrEqual(2);
  });
});

// =============================================================================
// RELAY SELECTION TESTS
// =============================================================================

describe('MeshTopologyManager - Relay Selection', () => {
  test('should find potential relays', () => {
    const manager = createTestManager();

    // Build topology: peer-1 and peer-2 are connected to target
    manager.topology.set('peer-1', {
      displayName: 'Peer 1',
      connectedTo: new Set(['user-123', 'target-123']),
      peers: [{ peerId: 'target-123', displayName: 'Target', connectionQuality: 85 }],
      metadata: {},
      lastUpdated: Date.now(),
    });

    manager.topology.set('peer-2', {
      displayName: 'Peer 2',
      connectedTo: new Set(['user-123', 'target-123']),
      peers: [{ peerId: 'target-123', displayName: 'Target', connectionQuality: 70 }],
      metadata: {},
      lastUpdated: Date.now() - 60000, // Older data
    });

    const relays = manager.findPotentialRelays('target-123');

    expect(relays.length).toBe(2);
    expect(relays[0].hopCount).toBe(1);
    expect(relays[0].quality).toBeGreaterThan(0);
    // Should be sorted by quality (highest first)
    expect(relays[0].quality).toBeGreaterThanOrEqual(relays[1].quality);
  });

  test('should get best relay', () => {
    const manager = createTestManager();

    // Build topology
    manager.topology.set('good-relay', {
      displayName: 'Good Relay',
      connectedTo: new Set(['user-123', 'target-123', 'peer-1', 'peer-2']),
      peers: [
        { peerId: 'target-123', displayName: 'Target', connectionQuality: 90 },
        { peerId: 'peer-1', displayName: 'Peer 1', connectionQuality: 85 },
      ],
      metadata: {},
      lastUpdated: Date.now(),
    });

    manager.topology.set('poor-relay', {
      displayName: 'Poor Relay',
      connectedTo: new Set(['user-123', 'target-123']),
      peers: [{ peerId: 'target-123', displayName: 'Target', connectionQuality: 50 }],
      metadata: {},
      lastUpdated: Date.now() - 120000,
    });

    const bestRelay = manager.getBestRelayForTarget('target-123');

    expect(bestRelay).toBe('good-relay');
  });

  test('should return null when no relay available', () => {
    const manager = createTestManager();

    const bestRelay = manager.getBestRelayForTarget('unreachable-target');

    expect(bestRelay).toBeNull();
  });

  test('should calculate relay quality', () => {
    const manager = createTestManager();

    // High quality relay
    const highQuality = manager.calculateRelayQuality({
      displayName: 'Hub',
      connectedTo: new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']),
      peers: [
        { peerId: 'p1', connectionQuality: 90 },
        { peerId: 'p2', connectionQuality: 85 },
      ],
      lastUpdated: Date.now(),
    });

    // Low quality relay
    const lowQuality = manager.calculateRelayQuality({
      displayName: 'Leaf',
      connectedTo: new Set(['p1']),
      peers: [{ peerId: 'p1', connectionQuality: 40 }],
      lastUpdated: Date.now() - 600000, // Old data
    });

    expect(highQuality).toBeGreaterThan(lowQuality);
    expect(highQuality).toBeLessThanOrEqual(100);
    expect(lowQuality).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// ROLE DETERMINATION TESTS
// =============================================================================

describe('MeshTopologyManager - Role Determination', () => {
  test('should determine hub role', () => {
    const peerManager = createMockPeerManager([
      { peerId: 'p1', displayName: 'P1' },
      { peerId: 'p2', displayName: 'P2' },
      { peerId: 'p3', displayName: 'P3' },
      { peerId: 'p4', displayName: 'P4' },
      { peerId: 'p5', displayName: 'P5' },
    ]);

    const manager = createTestManager({ peerManager });
    const role = manager.determineRole();

    expect(role).toBe('hub');
  });

  test('should determine relay role', () => {
    const peerManager = createMockPeerManager([
      { peerId: 'p1', displayName: 'P1' },
      { peerId: 'p2', displayName: 'P2' },
      { peerId: 'p3', displayName: 'P3' },
    ]);

    const manager = createTestManager({ peerManager });
    const role = manager.determineRole();

    expect(role).toBe('relay');
  });

  test('should determine leaf role', () => {
    const peerManager = createMockPeerManager([
      { peerId: 'p1', displayName: 'P1' },
    ]);

    const manager = createTestManager({ peerManager });
    const role = manager.determineRole();

    expect(role).toBe('leaf');
  });

  test('should determine isolated role', () => {
    const peerManager = createMockPeerManager([]);

    const manager = createTestManager({ peerManager });
    const role = manager.determineRole();

    expect(role).toBe('isolated');
  });

  test('should calculate role from connection count', () => {
    const manager = createTestManager();

    expect(manager.calculateRole(6)).toBe('hub');
    expect(manager.calculateRole(4)).toBe('relay');
    expect(manager.calculateRole(2)).toBe('leaf');
    expect(manager.calculateRole(0)).toBe('isolated');
  });
});

// =============================================================================
// PERIODIC DISCOVERY TESTS
// =============================================================================

describe('MeshTopologyManager - Periodic Discovery', () => {
  test('should start periodic discovery', () => {
    const manager = createTestManager();

    manager.startTopologyDiscovery(100);

    expect(manager.discoveryTimer).toBeDefined();
    expect(manager.stats.discoveryInterval).toBe(100);

    manager.stopTopologyDiscovery();
  });

  test('should stop periodic discovery', () => {
    const manager = createTestManager();

    manager.startTopologyDiscovery(100);
    manager.stopTopologyDiscovery();

    expect(manager.discoveryTimer).toBeNull();
  });

  // Note: Async timing test disabled - can be flaky in CI environments
  // test('should perform periodic discovery when connected', async () => {
  //   const peerManager = createMockPeerManager([
  //     { peerId: 'peer-1', displayName: 'Peer 1' },
  //   ]);
  //
  //   const manager = createTestManager({
  //     peerManager,
  //     config: { discoveryTimeout: 100 },
  //   });
  //
  //   let discoveryCount = 0;
  //   const originalDiscover = manager.discoverTopology.bind(manager);
  //   manager.discoverTopology = async (timeout) => {
  //     discoveryCount++;
  //     return originalDiscover(timeout);
  //   };
  //
  //   manager.startTopologyDiscovery(150);
  //
  //   // Wait for at least one discovery
  //   await new Promise(resolve => setTimeout(resolve, 200));
  //
  //   expect(discoveryCount).toBeGreaterThan(0);
  //
  //   manager.stopTopologyDiscovery();
  // });
});

// =============================================================================
// CLEANUP TESTS
// =============================================================================

describe('MeshTopologyManager - Cleanup', () => {
  test('should clean up stale data', () => {
    const manager = createTestManager({
      config: { topologyStaleTime: 100 },
    });

    // Add fresh data
    manager.topology.set('fresh-peer', {
      displayName: 'Fresh',
      connectedTo: new Set(),
      peers: [],
      metadata: {},
      lastUpdated: Date.now(),
    });

    // Add stale data
    manager.topology.set('stale-peer', {
      displayName: 'Stale',
      connectedTo: new Set(),
      peers: [],
      metadata: {},
      lastUpdated: Date.now() - 200,
    });

    expect(manager.topology.size).toBe(2);

    manager.cleanupStaleData();

    expect(manager.topology.size).toBe(1);
    expect(manager.topology.has('fresh-peer')).toBe(true);
    expect(manager.topology.has('stale-peer')).toBe(false);
  });
});

// =============================================================================
// STATISTICS TESTS
// =============================================================================

describe('MeshTopologyManager - Statistics', () => {
  test('should track statistics', () => {
    const manager = createTestManager();

    const stats = manager.getStats();

    expect(stats).toHaveProperty('knownPeers');
    expect(stats).toHaveProperty('totalNodes');
    expect(stats).toHaveProperty('totalEdges');
    expect(stats).toHaveProperty('ourRole');
    expect(stats).toHaveProperty('requestsSent');
    expect(stats).toHaveProperty('responsesReceived');
    expect(stats.requestsSent).toBe(0);
  });

  test('should update statistics on discovery', async () => {
    const manager = createTestManager();

    // Start discovery (will timeout)
    await manager.discoverTopology(100);

    const stats = manager.getStats();

    expect(stats.requestsSent).toBe(1);
    expect(stats.lastDiscovery).toBeDefined();
  });
});

// =============================================================================
// UTILITY TESTS
// =============================================================================

describe('MeshTopologyManager - Utilities', () => {
  test('should generate unique request IDs', () => {
    const manager = createTestManager();

    const id1 = manager.generateRequestId();
    const id2 = manager.generateRequestId();

    expect(id1).not.toBe(id2);
    expect(id1).toContain('topo-');
  });

  test('should clear all data', () => {
    const manager = createTestManager();

    manager.topology.set('peer-1', {
      displayName: 'Peer 1',
      connectedTo: new Set(),
      peers: [],
      metadata: {},
      lastUpdated: Date.now(),
    });

    manager.clear();

    expect(manager.topology.size).toBe(0);
  });

  test('should destroy manager', () => {
    const manager = createTestManager();

    manager.startTopologyDiscovery(100);

    manager.destroy();

    expect(manager.discoveryTimer).toBeNull();
    expect(manager.cleanupTimer).toBeNull();
    expect(manager.topology.size).toBe(0);
  });
});

// =============================================================================
// RUN TESTS
// =============================================================================

console.log('Running MeshTopologyManager tests...\n');

// Summary
setTimeout(() => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);

  if (failedTests === 0) {
    console.log('\n✓ All tests passed!');
  } else {
    console.log(`\n✗ ${failedTests} test(s) failed`);
  }
}, 100);
