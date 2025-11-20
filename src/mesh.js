import SimplePeer from 'simple-peer';
import MessageRouter from './mesh-router.js';
import PeerIntroductionManager from './mesh-introduction.js';
import LatencyManager from './mesh-latency.js';
import ConnectionManager from './mesh-connection.js';
import SecurityManager from './mesh-security.js';

// Multi-peer mesh network manager with automatic discovery and routing
class MeshNetwork {
  constructor(identity) {
    this.identity = identity;
    this.peers = new Map(); // uuid -> { peer, displayName, status, latency, connectedAt, connectionType }

    // Callbacks
    this.onMessage = null;
    this.onPeerConnect = null;
    this.onPeerDisconnect = null;
    this.onPeerUpdate = null;

    // Initialize subsystems
    this.router = new MessageRouter(identity);
    this.introManager = new PeerIntroductionManager(identity, 6);
    this.latencyManager = new LatencyManager(identity);
    this.connectionManager = new ConnectionManager(identity);
    this.securityManager = new SecurityManager();

    // Wire up subsystems
    this.router.setPeerManager(this);
    this.introManager.setPeerManager(this);
    this.introManager.setRouter(this.router);
    this.latencyManager.setPeerManager(this);
    this.latencyManager.setRouter(this.router);
    this.connectionManager.setPeerManager(this);

    // Register message handlers
    this.router.on('chat', (msg) => this.handleChatMessage(msg));
    this.router.on('name_change', (msg) => this.handleNameChange(msg));
    this.router.on('peer_introduction', (msg) => this.introManager.handleIntroduction(msg));
    this.router.on('relay_signal', (msg) => this.introManager.handleRelaySignal(msg));
    this.router.on('ping', (msg) => this.latencyManager.handlePing(msg));
    this.router.on('pong', (msg) => this.latencyManager.handlePong(msg));

    console.log('[Mesh] Network initialized with routing subsystems');
  }

  // Create an offer to invite someone
  async createOffer() {
    return new Promise((resolve) => {
      const peer = new SimplePeer({
        initiator: true,
        trickle: false,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
              urls: 'turn:openrelay.metered.ca:80',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
          ],
          iceTransportPolicy: 'all',
        },
      });

      peer.on('signal', (data) => {
        const offerData = {
          signal: data,
          uuid: this.identity.uuid,
          displayName: this.identity.displayName,
        };
        const encoded = btoa(JSON.stringify(offerData));
        resolve(encoded);
      });

      // Store peer temporarily until we get their identity
      peer._tempPeer = true;
      this._setupPeerHandlers(peer);
    });
  }

  // Accept an offer and return an answer
  async acceptOffer(encodedOffer) {
    return new Promise((resolve, reject) => {
      try {
        const offerData = JSON.parse(atob(encodedOffer));
        const { signal, uuid, displayName } = offerData;

        // Check if banned
        if (this.securityManager.isBanned(uuid)) {
          console.warn(`[Mesh] Peer ${uuid.substring(0, 8)} is banned`);
          reject(new Error('Peer is banned'));
          return;
        }

        const peer = new SimplePeer({
          initiator: false,
          trickle: false,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject',
              },
            ],
            iceTransportPolicy: 'all',
          },
        });

        peer.on('signal', (answerSignal) => {
          const answerData = {
            signal: answerSignal,
            uuid: this.identity.uuid,
            displayName: this.identity.displayName,
          };
          const encoded = btoa(JSON.stringify(answerData));
          resolve(encoded);
        });

        // Register this peer
        this.peers.set(uuid, {
          peer,
          displayName,
          status: 'connecting',
          latency: null,
          connectedAt: Date.now(),
          connectionType: null
        });

        this._setupPeerHandlers(peer, uuid);
        peer.signal(signal);
      } catch (e) {
        reject(e);
      }
    });
  }

  // Complete connection with answer (for initiator)
  acceptAnswer(encodedAnswer) {
    try {
      const answerData = JSON.parse(atob(encodedAnswer));
      const { signal, uuid, displayName } = answerData;

      // Check if banned
      if (this.securityManager.isBanned(uuid)) {
        console.warn(`[Mesh] Peer ${uuid.substring(0, 8)} is banned`);
        throw new Error('Peer is banned');
      }

      // Find the temporary peer
      let tempPeer = null;
      for (const [key, value] of this.peers.entries()) {
        if (key === '_temp' && value.peer._tempPeer) {
          tempPeer = value.peer;
          this.peers.delete(key);
          break;
        }
      }

      if (!tempPeer) {
        // Find peer without uuid
        for (const [key, value] of this.peers.entries()) {
          if (value.peer._tempPeer) {
            tempPeer = value.peer;
            this.peers.delete(key);
            break;
          }
        }
      }

      if (tempPeer) {
        this.peers.set(uuid, {
          peer: tempPeer,
          displayName,
          status: 'connecting',
          latency: null,
          connectedAt: Date.now(),
          connectionType: null
        });
        tempPeer._peerUUID = uuid;
        tempPeer.signal(signal);
      } else {
        throw new Error('No pending peer connection found');
      }
    } catch (e) {
      console.error('[Mesh] Accept answer error:', e);
      throw e;
    }
  }

  // Create connection through introduction
  async createIntroducedConnection(peerId, peerName, introId) {
    if (this.peers.has(peerId)) {
      console.log(`[Mesh] Already connected to ${peerId.substring(0, 8)}`);
      return false;
    }

    console.log(`[Mesh] Creating introduced connection to ${peerName}...`);

    const peer = new SimplePeer({
      initiator: true,
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
        ],
        iceTransportPolicy: 'all',
      },
    });

    // Wait for signal
    peer.on('signal', (signal) => {
      // Send offer through relay
      const relayMessage = this.router.createMessage('relay_signal', {
        signalType: 'offer',
        signal,
        fromPeerId: this.identity.uuid,
        fromName: this.identity.displayName,
        introductionId: introId
      }, { targetPeerId: peerId, ttl: 5 });

      this.router.routeMessage(relayMessage);
    });

    // Register peer
    this.peers.set(peerId, {
      peer,
      displayName: peerName,
      status: 'connecting',
      latency: null,
      connectedAt: Date.now(),
      connectionType: null
    });

    this._setupPeerHandlers(peer, peerId);

    return true;
  }

  // Handle relayed signal
  async handleRelayedSignal(fromPeerId, fromName, signal, signalType, introId) {
    console.log(`[Mesh] Handling relayed ${signalType} from ${fromName}`);

    if (signalType === 'offer') {
      // Create answer
      const peer = new SimplePeer({
        initiator: false,
        trickle: false,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
              urls: 'turn:openrelay.metered.ca:80',
              username: 'openrelayproject',
              credential: 'openrelayproject',
            },
          ],
          iceTransportPolicy: 'all',
        },
      });

      peer.on('signal', (answerSignal) => {
        // Send answer through relay
        const relayMessage = this.router.createMessage('relay_signal', {
          signalType: 'answer',
          signal: answerSignal,
          fromPeerId: this.identity.uuid,
          fromName: this.identity.displayName,
          introductionId: introId
        }, { targetPeerId: fromPeerId, ttl: 5 });

        this.router.routeMessage(relayMessage);
      });

      // Register peer
      this.peers.set(fromPeerId, {
        peer,
        displayName: fromName,
        status: 'connecting',
        latency: null,
        connectedAt: Date.now(),
        connectionType: null
      });

      this._setupPeerHandlers(peer, fromPeerId);
      peer.signal(signal);

    } else if (signalType === 'answer') {
      // Find existing peer and signal answer
      const peerData = this.peers.get(fromPeerId);
      if (peerData && peerData.peer) {
        peerData.peer.signal(signal);
      } else {
        console.warn(`[Mesh] No peer found for answer from ${fromPeerId.substring(0, 8)}`);
      }
    }
  }

  _setupPeerHandlers(peer, knownUUID = null) {
    peer.on('connect', () => {
      const uuid = knownUUID || peer._peerUUID;
      if (uuid && this.peers.has(uuid)) {
        const peerData = this.peers.get(uuid);
        peerData.status = 'connected';
        peerData.connectedAt = Date.now();
        this.peers.set(uuid, peerData);

        console.log(`[Mesh] Connected to ${peerData.displayName} (${uuid.substring(0, 8)})`);

        if (this.onPeerConnect) {
          this.onPeerConnect(uuid, peerData.displayName);
        }

        // Start latency measurement
        setTimeout(() => {
          this.latencyManager.pingPeer(uuid);
        }, 2000);
      }
    });

    peer.on('data', (data) => {
      try {
        const message = JSON.parse(data.toString());
        const uuid = knownUUID || peer._peerUUID;

        // Security checks
        if (!this.securityManager.validateMessageStructure(message)) {
          console.warn(`[Mesh] Invalid message from ${uuid?.substring(0, 8)}`);
          return;
        }

        if (uuid && !this.securityManager.checkRateLimit(uuid)) {
          console.warn(`[Mesh] Rate limit exceeded for ${uuid.substring(0, 8)}`);
          return;
        }

        // Route message through router
        this.router.routeMessage(message, uuid);
      } catch (e) {
        console.error('[Mesh] Error parsing message:', e);
      }
    });

    peer.on('close', () => {
      const uuid = knownUUID || peer._peerUUID;
      if (uuid && this.peers.has(uuid)) {
        console.log(`[Mesh] Disconnected from ${uuid.substring(0, 8)}`);
        this.peers.delete(uuid);
        if (this.onPeerDisconnect) {
          this.onPeerDisconnect(uuid);
        }
      }
    });

    peer.on('error', (err) => {
      console.error('[Mesh] Peer error:', err);
      const uuid = knownUUID || peer._peerUUID;
      if (uuid && this.peers.has(uuid)) {
        const peerData = this.peers.get(uuid);
        peerData.status = 'error';
        this.peers.set(uuid, peerData);
      }
    });

    // Store peer temporarily if UUID not known yet
    if (!knownUUID) {
      this.peers.set('_temp', {
        peer,
        displayName: 'Connecting...',
        status: 'connecting',
        latency: null,
        connectedAt: Date.now(),
        connectionType: null
      });
    }
  }

  // Handle chat message (routed)
  handleChatMessage(message) {
    if (this.onMessage) {
      const peerName = this.identity.getPeerDisplayName(message.senderId, message.senderName);
      this.onMessage(message.senderId, peerName, message.payload.text);
    }
  }

  // Handle name change
  handleNameChange(message) {
    const uuid = message.senderId;
    const newName = message.payload.newName;

    if (this.peers.has(uuid)) {
      const peerData = this.peers.get(uuid);
      peerData.displayName = newName;
      this.peers.set(uuid, peerData);

      if (this.onPeerUpdate) {
        this.onPeerUpdate(uuid, newName);
      }
    }
  }

  // Send a chat message (routed through mesh)
  sendMessage(text) {
    const sanitized = this.securityManager.sanitizeMessage(text);

    const chatMessage = this.router.createMessage('chat', {
      text: sanitized
    }, { routingHint: 'broadcast' });

    this.router.routeMessage(chatMessage);
  }

  // Broadcast display name change
  broadcastNameChange() {
    const nameMessage = this.router.createMessage('name_change', {
      newName: this.identity.displayName
    }, { routingHint: 'broadcast' });

    this.router.routeMessage(nameMessage);
  }

  // Get all connected peers
  getConnectedPeers() {
    return Array.from(this.peers.entries())
      .filter(([uuid, data]) => data.status === 'connected' && uuid !== '_temp')
      .map(([uuid, data]) => ({
        uuid,
        displayName: this.identity.getPeerDisplayName(uuid, data.displayName),
        originalDisplayName: data.displayName,
        latency: data.latency,
        uptime: data.connectedAt ? Math.floor((Date.now() - data.connectedAt) / 1000) : 0,
        quality: this.connectionManager.calculateQualityScore(uuid)
      }));
  }

  getConnectedPeerCount() {
    return Array.from(this.peers.values())
      .filter(data => data.status === 'connected').length;
  }

  // Get mesh statistics
  getStats() {
    return {
      peers: this.getConnectedPeerCount(),
      router: this.router.getStats(),
      latency: this.latencyManager.getStats(),
      connection: this.connectionManager.getConnectionStats(),
      security: this.securityManager.getStats()
    };
  }

  // Disconnect all peers
  destroy() {
    console.log('[Mesh] Shutting down network');

    // Stop subsystems
    this.router.stop();
    this.introManager.stop();
    this.latencyManager.stop();
    this.connectionManager.stop();

    // Destroy all peers
    for (const [uuid, data] of this.peers.entries()) {
      if (data.peer && !data.peer.destroyed) {
        data.peer.destroy();
      }
    }
    this.peers.clear();
  }
}

export default MeshNetwork;
