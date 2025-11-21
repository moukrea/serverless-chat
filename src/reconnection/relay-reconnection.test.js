/**
 * Unit Tests for ReconnectionManager
 *
 * Run with: npm test src/reconnection/relay-reconnection.test.js
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ReconnectionManager, { RECONNECT_MESSAGE_TYPES } from './relay-reconnection.js';

// =============================================================================
// MOCK IMPLEMENTATIONS
// =============================================================================

class MockRouter {
  constructor() {
    this.handlers = new Map();
    this.sentMessages = [];
  }

  on(msgType, handler) {
    this.handlers.set(msgType, handler);
  }

  createMessage(msgType, payload, options = {}) {
    return {
      msgId: `msg-${Date.now()}-${Math.random()}`,
      msgType,
      senderId: 'test-sender',
      senderName: 'Test Sender',
      timestamp: Date.now(),
      ttl: options.ttl || 7,
      hopCount: 0,
      path: ['test-sender'],
      targetPeerId: options.targetPeerId || null,
      routingHint: options.routingHint || 'broadcast',
      payload
    };
  }

  async routeMessage(message) {
    this.sentMessages.push(message);

    // Simulate message delivery to handlers
    const handler = this.handlers.get(message.msgType);
    if (handler) {
      setTimeout(() => handler(message), 0);
    }

    return true;
  }

  getSentMessages(msgType) {
    return this.sentMessages.filter(m => m.msgType === msgType);
  }

  clearMessages() {
    this.sentMessages = [];
  }
}

class MockPeerManager {
  constructor() {
    this.peers = new Map();
    this.maxConnections = 6;
    this.registeredPeers = [];
  }

  getConnectedPeerCount() {
    return Array.from(this.peers.values())
      .filter(p => p.status === 'connected')
      .length;
  }

  registerReconnectedPeer(peerId, peerName, peerConnection) {
    this.registeredPeers.push({ peerId, peerName, peerConnection });
    this.peers.set(peerId, {
      peer: peerConnection,
      status: 'connected',
      displayName: peerName
    });
  }

  addConnectedPeer(peerId, peerName) {
    this.peers.set(peerId, {
      status: 'connected',
      displayName: peerName
    });
  }
}

class MockPeerPersistence {
  constructor() {
    this.peers = new Map();
    this.failedAttempts = new Map();
  }

  async updateLastSeen(peerId) {
    if (this.peers.has(peerId)) {
      const peer = this.peers.get(peerId);
      peer.lastSeen = Date.now();
    }
  }

  async incrementReconnectionAttempts(peerId) {
    const count = this.failedAttempts.get(peerId) || 0;
    this.failedAttempts.set(peerId, count + 1);
  }

  getFailedAttempts(peerId) {
    return this.failedAttempts.get(peerId) || 0;
  }
}

class MockSimplePeer {
  constructor(options) {
    this.initiator = options.initiator;
    this.destroyed = false;
    this.connected = false;
    this.handlers = new Map();

    // Auto-generate offer if initiator
    if (this.initiator) {
      setTimeout(() => {
        this.emit('signal', {
          type: 'offer',
          sdp: 'mock-offer-sdp'
        });
      }, 10);
    }
  }

  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);
  }

  emit(event, data) {
    const handlers = this.handlers.get(event) || [];
    for (const handler of handlers) {
      handler(data);
    }
  }

  signal(data) {
    // Simulate answer generation
    if (!this.initiator && data.type === 'offer') {
      setTimeout(() => {
        this.emit('signal', {
          type: 'answer',
          sdp: 'mock-answer-sdp'
        });
      }, 10);
    }

    // Simulate connection establishment
    if (this.initiator && data.type === 'answer') {
      setTimeout(() => {
        this.connected = true;
        this.emit('connect');
      }, 50);
    } else if (!this.initiator) {
      setTimeout(() => {
        this.connected = true;
        this.emit('connect');
      }, 50);
    }
  }

  send(data) {
    if (!this.connected) {
      throw new Error('Peer not connected');
    }
  }

  destroy() {
    this.destroyed = true;
    this.emit('close');
  }

  simulateError(error) {
    this.emit('error', error);
  }
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe('ReconnectionManager', () => {
  let identity;
  let router;
  let peerManager;
  let peerPersistence;
  let reconnectionManager;

  beforeEach(() => {
    identity = {
      uuid: 'peer-A',
      displayName: 'Peer A'
    };

    router = new MockRouter();
    peerManager = new MockPeerManager();
    peerPersistence = new MockPeerPersistence();

    reconnectionManager = new ReconnectionManager(
      identity,
      router,
      peerManager,
      peerPersistence
    );

    // Mock SimplePeer
    global.SimplePeer = MockSimplePeer;
  });

  afterEach(() => {
    reconnectionManager.stop();
  });

  // ===========================================================================
  // INITIALIZATION TESTS
  // ===========================================================================

  describe('Initialization', () => {
    it('should initialize with correct identity', () => {
      expect(reconnectionManager.identity).toEqual(identity);
    });

    it('should register message handlers', () => {
      expect(router.handlers.size).toBeGreaterThan(0);
      expect(router.handlers.has(RECONNECT_MESSAGE_TYPES.RECONNECT_OFFER)).toBe(true);
      expect(router.handlers.has(RECONNECT_MESSAGE_TYPES.RECONNECT_ANSWER)).toBe(true);
      expect(router.handlers.has(RECONNECT_MESSAGE_TYPES.PATH_QUERY)).toBe(true);
      expect(router.handlers.has(RECONNECT_MESSAGE_TYPES.PATH_RESPONSE)).toBe(true);
    });

    it('should have empty initial state', () => {
      expect(reconnectionManager.pendingReconnects.size).toBe(0);
      expect(reconnectionManager.activeQueries.size).toBe(0);
      expect(reconnectionManager.pathQueryResponses.size).toBe(0);
    });

    it('should have zero initial statistics', () => {
      const stats = reconnectionManager.getStats();
      expect(stats.totalAttempts).toBe(0);
      expect(stats.successful).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  // ===========================================================================
  // PATH DISCOVERY TESTS
  // ===========================================================================

  describe('Path Discovery', () => {
    it('should send path query when finding path', async () => {
      const targetPeerId = 'peer-B';

      // Start path query (will timeout but we'll check the message)
      const pathPromise = reconnectionManager.findPathToTarget(targetPeerId, 100);

      // Wait for message to be sent
      await new Promise(resolve => setTimeout(resolve, 50));

      const pathQueries = router.getSentMessages(RECONNECT_MESSAGE_TYPES.PATH_QUERY);
      expect(pathQueries.length).toBe(1);
      expect(pathQueries[0].payload.targetPeerId).toBe(targetPeerId);
      expect(pathQueries[0].payload.queryOrigin).toBe(identity.uuid);

      await pathPromise;
    });

    it('should return false when no path found', async () => {
      const hasPath = await reconnectionManager.findPathToTarget('peer-B', 100);
      expect(hasPath).toBe(false);
    });

    it('should return true when path response received', async () => {
      const targetPeerId = 'peer-B';

      // Start path query
      const pathPromise = reconnectionManager.findPathToTarget(targetPeerId, 1000);

      // Wait a bit then send path response
      await new Promise(resolve => setTimeout(resolve, 50));

      const pathQueries = router.getSentMessages(RECONNECT_MESSAGE_TYPES.PATH_QUERY);
      const queryId = pathQueries[0].payload.queryId;

      // Simulate path response
      const pathResponse = router.createMessage(
        RECONNECT_MESSAGE_TYPES.PATH_RESPONSE,
        {
          queryId,
          targetPeerId,
          relayPeerId: 'peer-C',
          relayName: 'Peer C',
          hopCount: 1
        },
        {
          targetPeerId: identity.uuid
        }
      );

      router.routeMessage(pathResponse);

      const hasPath = await pathPromise;
      expect(hasPath).toBe(true);
    });

    it('should respond to path query if connected to target', async () => {
      const targetPeerId = 'peer-B';

      // Add target peer to peer manager
      peerManager.addConnectedPeer(targetPeerId, 'Peer B');

      // Simulate receiving path query
      const pathQuery = router.createMessage(
        RECONNECT_MESSAGE_TYPES.PATH_QUERY,
        {
          queryId: 'test-query-123',
          targetPeerId,
          queryOrigin: 'peer-C'
        }
      );

      router.routeMessage(pathQuery);

      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 50));

      const pathResponses = router.getSentMessages(RECONNECT_MESSAGE_TYPES.PATH_RESPONSE);
      expect(pathResponses.length).toBe(1);
      expect(pathResponses[0].payload.relayPeerId).toBe(identity.uuid);
      expect(pathResponses[0].targetPeerId).toBe('peer-C');
    });

    it('should not respond to path query if not connected to target', async () => {
      const pathQuery = router.createMessage(
        RECONNECT_MESSAGE_TYPES.PATH_QUERY,
        {
          queryId: 'test-query-123',
          targetPeerId: 'peer-B',
          queryOrigin: 'peer-C'
        }
      );

      router.routeMessage(pathQuery);

      await new Promise(resolve => setTimeout(resolve, 50));

      const pathResponses = router.getSentMessages(RECONNECT_MESSAGE_TYPES.PATH_RESPONSE);
      expect(pathResponses.length).toBe(0);
    });

    it('should not respond to own path queries', async () => {
      peerManager.addConnectedPeer('peer-B', 'Peer B');

      const pathQuery = router.createMessage(
        RECONNECT_MESSAGE_TYPES.PATH_QUERY,
        {
          queryId: 'test-query-123',
          targetPeerId: 'peer-B',
          queryOrigin: identity.uuid // Our own query
        }
      );

      router.routeMessage(pathQuery);

      await new Promise(resolve => setTimeout(resolve, 50));

      const pathResponses = router.getSentMessages(RECONNECT_MESSAGE_TYPES.PATH_RESPONSE);
      expect(pathResponses.length).toBe(0);
    });
  });

  // ===========================================================================
  // RECONNECTION TESTS
  // ===========================================================================

  describe('Reconnection', () => {
    it('should reject reconnection to self', async () => {
      const result = await reconnectionManager.reconnectViaMesh(
        identity.uuid,
        identity.displayName
      );

      expect(result.success).toBe(false);
      expect(result.reason).toBe('cannot_connect_to_self');
    });

    it('should reject reconnection if already connected', async () => {
      const targetPeerId = 'peer-B';

      // Add peer as already connected
      peerManager.addConnectedPeer(targetPeerId, 'Peer B');

      const result = await reconnectionManager.reconnectViaMesh(
        targetPeerId,
        'Peer B'
      );

      expect(result.success).toBe(false);
      expect(result.reason).toBe('already_connected');
    });

    it('should fail if no path found', async () => {
      const result = await reconnectionManager.reconnectViaMesh(
        'peer-B',
        'Peer B'
      );

      expect(result.success).toBe(false);
      expect(result.reason).toBe('no_path_found');
      expect(peerPersistence.getFailedAttempts('peer-B')).toBe(1);
    });

    it('should increment statistics on attempt', async () => {
      const initialStats = reconnectionManager.getStats();
      expect(initialStats.totalAttempts).toBe(0);

      await reconnectionManager.reconnectViaMesh('peer-B', 'Peer B');

      const finalStats = reconnectionManager.getStats();
      expect(finalStats.totalAttempts).toBe(1);
    });
  });

  // ===========================================================================
  // ACCEPTANCE TESTS
  // ===========================================================================

  describe('Reconnection Acceptance', () => {
    it('should accept reconnection from valid peer', () => {
      const shouldAccept = reconnectionManager.shouldAcceptReconnection('peer-B');
      // peer-B > peer-A lexicographically, so peer-A should accept
      expect(shouldAccept).toBe(true);
    });

    it('should reject reconnection to self', () => {
      const shouldAccept = reconnectionManager.shouldAcceptReconnection(identity.uuid);
      expect(shouldAccept).toBe(false);
    });

    it('should reject reconnection if already connected', () => {
      peerManager.addConnectedPeer('peer-B', 'Peer B');

      const shouldAccept = reconnectionManager.shouldAcceptReconnection('peer-B');
      expect(shouldAccept).toBe(false);
    });

    it('should reject reconnection at max connections', () => {
      // Fill up to max connections
      for (let i = 0; i < peerManager.maxConnections; i++) {
        peerManager.addConnectedPeer(`peer-${i}`, `Peer ${i}`);
      }

      const shouldAccept = reconnectionManager.shouldAcceptReconnection('peer-new');
      expect(shouldAccept).toBe(false);
    });

    it('should use deterministic tie-breaking', () => {
      // peer-A (us) vs peer-B (them)
      // peer-A < peer-B, so we should initiate, not accept
      identity.uuid = 'peer-A';
      const shouldAccept1 = reconnectionManager.shouldAcceptReconnection('peer-B');
      expect(shouldAccept1).toBe(false);

      // peer-C (us) vs peer-B (them)
      // peer-C > peer-B, so we should accept
      identity.uuid = 'peer-C';
      reconnectionManager.identity = identity;
      const shouldAccept2 = reconnectionManager.shouldAcceptReconnection('peer-B');
      expect(shouldAccept2).toBe(true);
    });
  });

  // ===========================================================================
  // MESSAGE HANDLING TESTS
  // ===========================================================================

  describe('Message Handling', () => {
    it('should handle reconnect offer and send answer', async () => {
      const offerMessage = router.createMessage(
        RECONNECT_MESSAGE_TYPES.RECONNECT_OFFER,
        {
          reconnectId: 'reconnect-123',
          offer: btoa(JSON.stringify({ type: 'offer', sdp: 'mock-sdp' })),
          requesterPeerId: 'peer-Z', // Greater than peer-A
          requesterName: 'Peer Z',
          timestamp: Date.now()
        },
        {
          targetPeerId: identity.uuid
        }
      );

      router.routeMessage(offerMessage);

      // Wait for answer
      await new Promise(resolve => setTimeout(resolve, 100));

      const answers = router.getSentMessages(RECONNECT_MESSAGE_TYPES.RECONNECT_ANSWER);
      expect(answers.length).toBe(1);
      expect(answers[0].payload.reconnectId).toBe('reconnect-123');
      expect(answers[0].payload.acceptorPeerId).toBe(identity.uuid);
    });

    it('should send rejection if should not accept', async () => {
      // Already connected to peer
      peerManager.addConnectedPeer('peer-B', 'Peer B');

      const offerMessage = router.createMessage(
        RECONNECT_MESSAGE_TYPES.RECONNECT_OFFER,
        {
          reconnectId: 'reconnect-123',
          offer: btoa(JSON.stringify({ type: 'offer', sdp: 'mock-sdp' })),
          requesterPeerId: 'peer-B',
          requesterName: 'Peer B',
          timestamp: Date.now()
        },
        {
          targetPeerId: identity.uuid
        }
      );

      router.routeMessage(offerMessage);

      // Wait for rejection
      await new Promise(resolve => setTimeout(resolve, 50));

      const rejections = router.getSentMessages(RECONNECT_MESSAGE_TYPES.RECONNECT_REJECTION);
      expect(rejections.length).toBe(1);
      expect(rejections[0].payload.reconnectId).toBe('reconnect-123');
      expect(rejections[0].payload.reason).toBe('already_connected');
    });
  });

  // ===========================================================================
  // STATISTICS TESTS
  // ===========================================================================

  describe('Statistics', () => {
    it('should track total attempts', async () => {
      await reconnectionManager.reconnectViaMesh('peer-B', 'Peer B');
      await reconnectionManager.reconnectViaMesh('peer-C', 'Peer C');

      const stats = reconnectionManager.getStats();
      expect(stats.totalAttempts).toBe(2);
    });

    it('should track path not found', async () => {
      await reconnectionManager.reconnectViaMesh('peer-B', 'Peer B');

      const stats = reconnectionManager.getStats();
      expect(stats.pathNotFound).toBe(1);
    });

    it('should calculate success rate', async () => {
      // No attempts yet
      let stats = reconnectionManager.getStats();
      expect(stats.successRate).toBe('N/A');

      // After attempts
      reconnectionManager.stats.totalAttempts = 10;
      reconnectionManager.stats.successful = 7;

      stats = reconnectionManager.getStats();
      expect(stats.successRate).toBe('70.0%');
    });
  });

  // ===========================================================================
  // STATE MANAGEMENT TESTS
  // ===========================================================================

  describe('State Management', () => {
    it('should return current state', () => {
      const state = reconnectionManager.getState();

      expect(state).toHaveProperty('pendingReconnects');
      expect(state).toHaveProperty('activeQueries');
      expect(state).toHaveProperty('pathQueryResponses');

      expect(Array.isArray(state.pendingReconnects)).toBe(true);
      expect(Array.isArray(state.activeQueries)).toBe(true);
      expect(Array.isArray(state.pathQueryResponses)).toBe(true);
    });

    it('should clean up stale state', async () => {
      // Create fake stale query
      reconnectionManager.activeQueries.set('old-query', {
        targetPeerId: 'peer-B',
        startTime: Date.now() - 100000, // 100 seconds ago
        resolve: () => {},
        reject: () => {}
      });

      // Run cleanup
      reconnectionManager.cleanup();

      // Should be removed
      expect(reconnectionManager.activeQueries.has('old-query')).toBe(false);
    });
  });

  // ===========================================================================
  // CLEANUP TESTS
  // ===========================================================================

  describe('Cleanup', () => {
    it('should stop all timers on stop', () => {
      const timersBefore = reconnectionManager.cleanupTimer;
      expect(timersBefore).toBeDefined();

      reconnectionManager.stop();

      expect(reconnectionManager.pendingReconnects.size).toBe(0);
      expect(reconnectionManager.activeQueries.size).toBe(0);
    });

    it('should destroy pending peers on stop', async () => {
      // Create a fake pending reconnection
      const mockPeer = new MockSimplePeer({ initiator: true });
      reconnectionManager.pendingReconnects.set('test-reconnect', {
        targetPeerId: 'peer-B',
        peer: mockPeer,
        startTime: Date.now(),
        resolve: () => {},
        reject: () => {},
        timeout: setTimeout(() => {}, 10000)
      });

      reconnectionManager.stop();

      expect(mockPeer.destroyed).toBe(true);
      expect(reconnectionManager.pendingReconnects.size).toBe(0);
    });
  });
});
