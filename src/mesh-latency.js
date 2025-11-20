// Latency Measurement and Path Discovery

class LatencyManager {
  constructor(identity) {
    this.identity = identity;
    this.peerManager = null;
    this.router = null;

    // Latency data
    this.directLatencies = new Map(); // peerId -> latency (ms)
    this.pendingPings = new Map(); // pingId -> { timestamp, targetPeerId }

    // Configuration
    this.pingInterval = 15000; // 15 seconds
    this.maxPendingPings = 100;
    this.pingTimeout = 5000; // 5 seconds

    // Start periodic ping
    this.startPeriodicPing();
  }

  setPeerManager(peerManager) {
    this.peerManager = peerManager;
  }

  setRouter(router) {
    this.router = router;
  }

  // Start pinging all connected peers periodically
  startPeriodicPing() {
    this.pingTimer = setInterval(() => {
      this.pingAllPeers();
    }, this.pingInterval);
  }

  pingAllPeers() {
    if (!this.peerManager) return;

    const peers = Array.from(this.peerManager.peers.entries())
      .filter(([id, data]) => data.status === 'connected' && id !== '_temp');

    for (const [peerId] of peers) {
      this.pingPeer(peerId);
    }
  }

  pingPeer(peerId) {
    if (!this.router) return;

    const pingId = this.generatePingId();

    this.pendingPings.set(pingId, {
      timestamp: Date.now(),
      targetPeerId: peerId
    });

    // Send ping message
    const pingMessage = this.router.createMessage('ping', {
      pingId
    }, { targetPeerId: peerId, ttl: 5 });

    this.router.routeMessage(pingMessage);

    // Cleanup timeout
    setTimeout(() => {
      if (this.pendingPings.has(pingId)) {
        console.log(`[Latency] Ping ${pingId} to ${peerId.substring(0, 8)} timed out`);
        this.pendingPings.delete(pingId);
      }
    }, this.pingTimeout);

    // Prevent unbounded growth
    if (this.pendingPings.size > this.maxPendingPings) {
      this.pruneOldestPings(20);
    }
  }

  // Handle ping request
  async handlePing(message) {
    if (!this.router) return;

    const { pingId } = message.payload;

    // Send pong response
    const pongMessage = this.router.createMessage('pong', {
      pingId
    }, { targetPeerId: message.senderId, ttl: 5 });

    this.router.routeMessage(pongMessage);
  }

  // Handle pong response
  async handlePong(message) {
    const { pingId } = message.payload;

    const pending = this.pendingPings.get(pingId);
    if (!pending) {
      return; // Unknown or already processed
    }

    const latency = Date.now() - pending.timestamp;

    // Update latency for the sender (considering hops)
    const senderId = message.senderId;
    this.updateLatency(senderId, latency, message.hopCount);

    this.pendingPings.delete(pingId);
  }

  updateLatency(peerId, latency, hopCount) {
    // Store the latency
    this.directLatencies.set(peerId, latency);

    // Update peer manager if it's a direct connection
    if (this.peerManager && this.peerManager.peers.has(peerId)) {
      const peerData = this.peerManager.peers.get(peerId);
      if (hopCount <= 1) {
        // Direct connection, use exact latency
        peerData.latency = latency;
      } else {
        // Multi-hop, estimate
        peerData.latency = Math.floor(latency / hopCount);
      }
      console.log(`[Latency] ${peerId.substring(0, 8)}: ${latency}ms (${hopCount} hops)`);
    }
  }

  getLatency(peerId) {
    return this.directLatencies.get(peerId) || null;
  }

  getBestPeer(candidates) {
    if (!candidates || candidates.length === 0) return null;

    let bestPeer = null;
    let bestLatency = Infinity;

    for (const peerId of candidates) {
      const latency = this.directLatencies.get(peerId);
      if (latency && latency < bestLatency) {
        bestLatency = latency;
        bestPeer = peerId;
      }
    }

    // If no latency data, return random
    if (!bestPeer && candidates.length > 0) {
      bestPeer = candidates[Math.floor(Math.random() * candidates.length)];
    }

    return bestPeer;
  }

  generatePingId() {
    return `ping-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  pruneOldestPings(count) {
    const sorted = Array.from(this.pendingPings.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    for (let i = 0; i < count && i < sorted.length; i++) {
      this.pendingPings.delete(sorted[i][0]);
    }
  }

  getStats() {
    const latencies = [];
    for (const [peerId, latency] of this.directLatencies.entries()) {
      latencies.push({ peerId: peerId.substring(0, 8), latency });
    }

    return {
      measuredPeers: latencies.length,
      pendingPings: this.pendingPings.size,
      latencies: latencies.sort((a, b) => a.latency - b.latency)
    };
  }

  stop() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }
  }
}

export default LatencyManager;
