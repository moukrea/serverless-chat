// Connection Quality Management

class ConnectionManager {
  constructor(identity, config = {}) {
    this.identity = identity;
    this.peerManager = null;

    // Configuration
    this.config = {
      maxConnections: config.maxConnections || 6,
      minConnections: config.minConnections || 2,
      targetConnections: config.targetConnections || 4,
      qualityThreshold: config.qualityThreshold || 40,
      rebalanceInterval: config.rebalanceInterval || 60000 // 1 minute
    };

    // Connection scores
    this.connectionScores = new Map(); // peerId -> score (0-100)

    // Start rebalancing
    this.startRebalancing();
  }

  setPeerManager(peerManager) {
    this.peerManager = peerManager;
  }

  // Calculate connection quality score (0-100)
  calculateQualityScore(peerId) {
    if (!this.peerManager) return 0;

    const peerData = this.peerManager.peers.get(peerId);
    if (!peerData) return 0;

    let score = 0;

    // Latency score (40 points max)
    if (peerData.latency !== null && peerData.latency !== undefined) {
      if (peerData.latency < 100) score += 40;
      else if (peerData.latency < 200) score += 30;
      else if (peerData.latency < 500) score += 20;
      else if (peerData.latency < 1000) score += 10;
      // else 0 points
    } else {
      // No latency data yet, give some points
      score += 20;
    }

    // Connection type score (30 points max)
    if (peerData.connectionType) {
      if (peerData.connectionType.includes('host')) score += 30; // Direct
      else if (peerData.connectionType.includes('srflx')) score += 20; // STUN
      else if (peerData.connectionType.includes('relay')) score += 10; // TURN
    } else {
      score += 15; // Unknown, give moderate score
    }

    // Stability score (30 points max)
    const uptime = this.getConnectionUptime(peerId);
    if (uptime > 600) score += 30; // 10+ minutes
    else if (uptime > 300) score += 20; // 5+ minutes
    else if (uptime > 60) score += 10; // 1+ minute
    // else 0 points

    this.connectionScores.set(peerId, score);
    return score;
  }

  getConnectionUptime(peerId) {
    if (!this.peerManager) return 0;

    const peerData = this.peerManager.peers.get(peerId);
    if (!peerData || !peerData.connectedAt) return 0;

    return Math.floor((Date.now() - peerData.connectedAt) / 1000);
  }

  // Should we accept a new peer connection?
  shouldAcceptConnection(newPeerQuality) {
    if (!this.peerManager) return { accept: false, reason: 'no_peer_manager' };

    const currentCount = this.peerManager.getConnectedPeerCount();

    // Always accept if below target
    if (currentCount < this.config.targetConnections) {
      return { accept: true, reason: 'below_target' };
    }

    // Never accept if at max
    if (currentCount >= this.config.maxConnections) {
      // Unless new peer is significantly better
      const worstPeer = this.getWorstConnection();
      if (worstPeer && newPeerQuality.score > worstPeer.score + 20) {
        return {
          accept: true,
          reason: 'replacement',
          replacePeerId: worstPeer.peerId
        };
      }
      return { accept: false, reason: 'at_max_capacity' };
    }

    // Between target and max: accept if quality is good
    if (newPeerQuality.score >= this.config.qualityThreshold) {
      return { accept: true, reason: 'good_quality' };
    }

    return { accept: false, reason: 'low_quality' };
  }

  getWorstConnection() {
    if (!this.peerManager) return null;

    let worstPeer = null;
    let worstScore = Infinity;

    for (const [peerId, data] of this.peerManager.peers.entries()) {
      if (data.status !== 'connected' || peerId === '_temp') continue;

      const score = this.calculateQualityScore(peerId);
      if (score < worstScore) {
        worstScore = score;
        worstPeer = { peerId, score };
      }
    }

    return worstPeer;
  }

  getBestConnection() {
    if (!this.peerManager) return null;

    let bestPeer = null;
    let bestScore = -Infinity;

    for (const [peerId, data] of this.peerManager.peers.entries()) {
      if (data.status !== 'connected' || peerId === '_temp') continue;

      const score = this.calculateQualityScore(peerId);
      if (score > bestScore) {
        bestScore = score;
        bestPeer = { peerId, score };
      }
    }

    return bestPeer;
  }

  // Periodically rebalance connections
  startRebalancing() {
    this.rebalanceTimer = setInterval(() => {
      this.rebalanceConnections();
    }, this.config.rebalanceInterval);
  }

  rebalanceConnections() {
    if (!this.peerManager) return;

    const currentCount = this.peerManager.getConnectedPeerCount();

    // Too few connections?
    if (currentCount < this.config.minConnections) {
      // Would need to trigger peer discovery, but that's handled by introduction manager
      return;
    }

    // Too many connections?
    if (currentCount > this.config.maxConnections) {
      this.pruneWorstConnection();
      return;
    }

    // Check for low-quality connections
    const lowQuality = this.findLowQualityConnections();
    if (lowQuality.length > 0) {
      // Could trigger replacement, but for now just log
    }
  }

  findLowQualityConnections() {
    if (!this.peerManager) return [];

    const lowQuality = [];

    for (const [peerId, data] of this.peerManager.peers.entries()) {
      if (data.status !== 'connected' || peerId === '_temp') continue;

      const score = this.calculateQualityScore(peerId);
      if (score < this.config.qualityThreshold) {
        lowQuality.push({ peerId, score });
      }
    }

    return lowQuality;
  }

  pruneWorstConnection() {
    const worst = this.getWorstConnection();
    if (worst && this.peerManager) {
      const peerData = this.peerManager.peers.get(worst.peerId);
      if (peerData && peerData.peer) {
        peerData.peer.destroy();
      }
      this.peerManager.peers.delete(worst.peerId);
    }
  }

  getConnectionStats() {
    if (!this.peerManager) return null;

    const scores = [];
    for (const [peerId, data] of this.peerManager.peers.entries()) {
      if (data.status !== 'connected' || peerId === '_temp') continue;

      scores.push({
        peerId: peerId.substring(0, 8),
        score: this.calculateQualityScore(peerId),
        latency: data.latency,
        uptime: this.getConnectionUptime(peerId)
      });
    }

    return {
      count: this.peerManager.getConnectedPeerCount(),
      target: this.config.targetConnections,
      max: this.config.maxConnections,
      scores: scores.sort((a, b) => b.score - a.score)
    };
  }

  stop() {
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
    }
  }
}

export default ConnectionManager;
