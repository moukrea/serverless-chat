// Peer Introduction Manager - Automatic Peer Discovery

class PeerIntroductionManager {
  constructor(identity, maxConnections = 6) {
    this.identity = identity;
    this.maxConnections = maxConnections;
    this.peerManager = null; // Set by mesh.js
    this.router = null; // Set by mesh.js

    // Track introductions
    this.introductionsSent = new Map(); // introId -> { peerA, peerB, timestamp }
    this.introductionsReceived = new Set(); // Set of introIds we've seen
    this.pendingConnections = new Map(); // peerId -> { signal, timestamp }

    // Configuration
    this.introductionTimeout = 30000; // 30 seconds
    this.cooldownPeriod = 60000; // 1 minute between attempts
    this.autoIntroduceInterval = 30000; // 30 seconds

    // Start automatic introduction
    this.startAutoIntroduce();
  }

  setPeerManager(peerManager) {
    this.peerManager = peerManager;
  }

  setRouter(router) {
    this.router = router;
  }

  // Main introduction logic - A introduces B to C
  introducePeers(peerBId, peerCId) {
    if (!this.shouldIntroduce(peerBId, peerCId)) {
      return false;
    }

    const introId = `${peerBId}-${peerCId}-${Date.now()}`;

    console.log(`[Intro] Introducing ${peerBId.substring(0, 8)} to ${peerCId.substring(0, 8)}`);

    const peerBData = this.peerManager.peers.get(peerBId);
    const peerCData = this.peerManager.peers.get(peerCId);

    if (!peerBData || !peerCData) {
      console.warn('[Intro] One or both peers not found');
      return false;
    }

    // Tell C about B
    const introCToB = this.router.createMessage('peer_introduction', {
      introducedPeerId: peerBId,
      introducedName: peerBData.displayName,
      introductionId: introId,
      connectionQuality: {
        latency: peerBData.latency || null,
        uptime: this.getUptime(peerBId)
      }
    }, { targetPeerId: peerCId, ttl: 3 });

    this.router.routeMessage(introCToB);

    // Tell B about C
    const introBToC = this.router.createMessage('peer_introduction', {
      introducedPeerId: peerCId,
      introducedName: peerCData.displayName,
      introductionId: introId,
      connectionQuality: {
        latency: peerCData.latency || null,
        uptime: this.getUptime(peerCId)
      }
    }, { targetPeerId: peerBId, ttl: 3 });

    this.router.routeMessage(introBToC);

    // Track this introduction
    this.introductionsSent.set(introId, {
      peerA: peerBId,
      peerB: peerCId,
      timestamp: Date.now()
    });

    // Cleanup after timeout
    setTimeout(() => {
      this.introductionsSent.delete(introId);
    }, this.introductionTimeout);

    return true;
  }

  shouldIntroduce(peerBId, peerCId) {
    // Both must be connected
    const peerB = this.peerManager.peers.get(peerBId);
    const peerC = this.peerManager.peers.get(peerCId);

    if (!peerB || !peerC) return false;
    if (peerB.status !== 'connected' || peerC.status !== 'connected') return false;

    // Check for recent introduction attempts
    const recentIntro = this.findRecentIntroduction(peerBId, peerCId);
    if (recentIntro && Date.now() - recentIntro.timestamp < this.cooldownPeriod) {
      return false;
    }

    // Don't introduce if they might already be connected
    // (This is a heuristic - we can't know for sure without tracking the full graph)
    return true;
  }

  findRecentIntroduction(peerAId, peerBId) {
    for (const [introId, intro] of this.introductionsSent.entries()) {
      if ((intro.peerA === peerAId && intro.peerB === peerBId) ||
          (intro.peerA === peerBId && intro.peerB === peerAId)) {
        return intro;
      }
    }
    return null;
  }

  // Handle receiving an introduction
  async handleIntroduction(message) {
    const {
      introducedPeerId,
      introducedName,
      introductionId,
      connectionQuality
    } = message.payload;

    console.log(`[Intro] Received introduction to ${introducedName} (${introducedPeerId.substring(0, 8)})`);

    // Don't process same introduction twice
    if (this.introductionsReceived.has(introductionId)) {
      console.log('[Intro] Already processed this introduction');
      return;
    }

    this.introductionsReceived.add(introductionId);

    // Cleanup old introduction IDs
    if (this.introductionsReceived.size > 100) {
      const arr = Array.from(this.introductionsReceived);
      this.introductionsReceived = new Set(arr.slice(-50));
    }

    // Check if we should accept this introduction
    if (!this.shouldAcceptIntroduction(introducedPeerId, connectionQuality)) {
      console.log(`[Intro] Declining introduction to ${introducedPeerId.substring(0, 8)}`);
      return;
    }

    // Check if we're already connected
    if (this.peerManager.peers.has(introducedPeerId)) {
      console.log(`[Intro] Already connected to ${introducedPeerId.substring(0, 8)}`);
      return;
    }

    // Use deterministic tie-breaking to decide who initiates
    if (this.identity.uuid < introducedPeerId) {
      // We initiate
      console.log(`[Intro] We initiate connection to ${introducedName}`);
      setTimeout(() => {
        this.initiateConnection(introducedPeerId, introducedName, introductionId);
      }, 1000);
    } else {
      // Wait for them to initiate
      console.log(`[Intro] Waiting for ${introducedName} to initiate`);
      this.pendingConnections.set(introducedPeerId, {
        name: introducedName,
        timestamp: Date.now(),
        introductionId
      });

      // Cleanup after timeout
      setTimeout(() => {
        this.pendingConnections.delete(introducedPeerId);
      }, this.introductionTimeout);
    }
  }

  shouldAcceptIntroduction(peerId, connectionQuality) {
    // Don't connect to ourselves
    if (peerId === this.identity.uuid) return false;

    // Already connected?
    if (this.peerManager.peers.has(peerId)) return false;

    // At max connections?
    const currentCount = this.peerManager.getConnectedPeerCount();
    if (currentCount >= this.maxConnections) {
      console.log(`[Intro] At max connections (${currentCount}/${this.maxConnections})`);
      return false;
    }

    // Connection quality threshold
    if (connectionQuality && connectionQuality.latency > 2000) {
      console.log('[Intro] Peer latency too high');
      return false;
    }

    return true;
  }

  async initiateConnection(peerId, peerName, introId) {
    if (this.peerManager.peers.has(peerId)) {
      console.log(`[Intro] Already connected to ${peerId.substring(0, 8)}`);
      return;
    }

    console.log(`[Intro] Creating connection to ${peerName}...`);

    // Create the connection through mesh manager
    // This will be handled by mesh.js's createPeerConnection method
    const success = await this.peerManager.createIntroducedConnection(peerId, peerName, introId);

    if (success) {
      console.log(`[Intro] Successfully initiated connection to ${peerName}`);
    } else {
      console.warn(`[Intro] Failed to initiate connection to ${peerName}`);
    }
  }

  // Handle relay signal (offer/answer through intermediary)
  async handleRelaySignal(message) {
    const {
      signalType,
      signal,
      fromPeerId,
      fromName,
      introductionId
    } = message.payload;

    console.log(`[Intro] Received ${signalType} from ${fromName} (${fromPeerId.substring(0, 8)})`);

    // Are we expecting this?
    const pending = this.pendingConnections.get(fromPeerId);
    if (!pending) {
      console.warn(`[Intro] Unexpected signal from ${fromPeerId.substring(0, 8)}`);
      // Still try to handle it
    }

    // Let mesh manager handle the signal
    await this.peerManager.handleRelayedSignal(fromPeerId, fromName, signal, signalType, introductionId);

    // Cleanup pending
    this.pendingConnections.delete(fromPeerId);
  }

  // Automatic peer introduction
  startAutoIntroduce() {
    this.autoIntroduceTimer = setInterval(() => {
      this.autoIntroducePeers();
    }, this.autoIntroduceInterval);
  }

  autoIntroducePeers() {
    const peers = Array.from(this.peerManager.peers.entries())
      .filter(([id, data]) => data.status === 'connected' && id !== '_temp')
      .map(([id]) => id);

    if (peers.length < 2) {
      return; // Need at least 2 peers to introduce
    }

    // Introduce all pairs
    for (let i = 0; i < peers.length - 1; i++) {
      for (let j = i + 1; j < peers.length; j++) {
        this.introducePeers(peers[i], peers[j]);
      }
    }
  }

  getUptime(peerId) {
    const peerData = this.peerManager.peers.get(peerId);
    if (!peerData || !peerData.connectedAt) {
      return 0;
    }
    return Math.floor((Date.now() - peerData.connectedAt) / 1000);
  }

  stop() {
    if (this.autoIntroduceTimer) {
      clearInterval(this.autoIntroduceTimer);
    }
  }
}

export default PeerIntroductionManager;
