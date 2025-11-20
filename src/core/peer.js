/**
 * Peer connection management
 */
import SimplePeer from 'simple-peer';

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
  iceTransportPolicy: 'all',
  iceCandidatePoolSize: 10,
};

class PeerManager {
  constructor() {
    this.peers = new Map();
    this.pendingConnections = new Map();
    this.onMessageCallback = null;
    this.onConnectionCallback = null;
    this.onDisconnectionCallback = null;
  }

  createPeer(peerId, initiator) {
    const peer = new SimplePeer({
      initiator,
      trickle: false,
      config: ICE_CONFIG,
    });

    this.peers.set(peerId, {
      peer,
      latency: null,
      status: 'connecting',
      connectionType: null,
    });

    this.setupPeerHandlers(peerId, peer);
    return peer;
  }

  setupPeerHandlers(peerId, peer) {
    peer.on('signal', data => {
      peer._signalData = data;
    });

    peer.on('connect', () => {
      const peerData = this.peers.get(peerId);
      if (peerData) {
        peerData.status = 'connected';
        this.detectConnectionType(peerId, peer);
      }

      if (this.onConnectionCallback) {
        this.onConnectionCallback(peerId);
      }

      this.startLatencyMeasurement(peerId);
    });

    peer.on('data', data => {
      try {
        const message = JSON.parse(data.toString());
        if (this.onMessageCallback) {
          this.onMessageCallback(peerId, message);
        }
      } catch (e) {
        console.error('Failed to parse peer message:', e);
      }
    });

    peer.on('error', err => {
      console.error(`Peer ${peerId} error:`, err);
      const peerData = this.peers.get(peerId);
      if (peerData) peerData.status = 'failed';
    });

    peer.on('close', () => {
      this.peers.delete(peerId);
      if (this.onDisconnectionCallback) {
        this.onDisconnectionCallback(peerId);
      }
    });
  }

  async detectConnectionType(peerId, peer) {
    setTimeout(async () => {
      try {
        const stats = await peer._pc.getStats();
        const peerData = this.peers.get(peerId);
        if (!peerData) return;

        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            stats.forEach(candidate => {
              if (candidate.id === report.localCandidateId) {
                peerData.connectionType =
                  candidate.candidateType === 'relay'
                    ? 'relay'
                    : `${candidate.candidateType}-${candidate.protocol || 'unknown'}`;
              }
            });
          }
        });
      } catch (e) {
        console.error('Failed to detect connection type:', e);
      }
    }, 500);
  }

  startLatencyMeasurement(peerId) {
    const measure = () => {
      if (this.peers.has(peerId) && this.peers.get(peerId).peer.connected) {
        this.sendToPeer(peerId, { type: 'ping', timestamp: Date.now() });
        setTimeout(measure, 5000);
      }
    };
    setTimeout(measure, 1000);
  }

  handlePong(peerId, timestamp) {
    const peerData = this.peers.get(peerId);
    if (peerData) {
      peerData.latency = Date.now() - timestamp;
    }
  }

  sendToPeer(peerId, message) {
    const peerData = this.peers.get(peerId);
    if (peerData && peerData.peer.connected) {
      try {
        peerData.peer.send(JSON.stringify(message));
        return true;
      } catch (e) {
        console.error(`Failed to send to peer ${peerId}:`, e);
      }
    }
    return false;
  }

  broadcast(message, excludePeerId = null) {
    let sent = 0;
    this.peers.forEach((data, peerId) => {
      if (peerId !== excludePeerId && data.peer.connected) {
        if (this.sendToPeer(peerId, message)) {
          sent++;
        }
      }
    });
    return sent;
  }

  disconnectPeer(peerId) {
    const peerData = this.peers.get(peerId);
    if (peerData) {
      try {
        peerData.peer.destroy();
      } catch (e) {
        console.error(`Error disconnecting peer ${peerId}:`, e);
      }
      this.peers.delete(peerId);
    }
  }

  getPeerData(peerId) {
    return this.peers.get(peerId);
  }

  getAllPeers() {
    return Array.from(this.peers.entries());
  }

  getPeerCount() {
    return this.peers.size;
  }

  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  onConnection(callback) {
    this.onConnectionCallback = callback;
  }

  onDisconnection(callback) {
    this.onDisconnectionCallback = callback;
  }
}

export default new PeerManager();
