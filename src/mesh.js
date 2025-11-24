import SimplePeer from 'simple-peer';
import MessageRouter from './mesh-router.js';
import PeerIntroductionManager from './mesh-introduction.js';
import LatencyManager from './mesh-latency.js';
import ConnectionManager from './mesh-connection.js';
import SecurityManager from './mesh-security.js';
import ICE_CONFIG from './config/ice-config.js';

// Reconnection system imports
import MasterReconnectionStrategy from './reconnection/master-reconnection.js';
import { PeerPersistenceManager } from './storage/peer-persistence.js';
import ReconnectionAuth from './reconnection-auth.js';
import NetworkChangeDetector from './network/change-detector.js';

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

    // Initialize reconnection system (async)
    this.reconnectionEnabled = true;
    this.reconnectionReady = false; // Flag to track initialization completion
    this._initPromise = this.initializeReconnectionSystem();

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

    if (this.reconnectionEnabled) {
    }
  }

  // Initialize reconnection system
  async initializeReconnectionSystem() {
    const startTime = Date.now();
    try {
      // Initialize peer persistence
      this.peerPersistence = new PeerPersistenceManager({
        storagePrefix: 'mesh',
        maxPeers: 100,
        cleanupStrategy: 'hybrid'
      });
      await this.peerPersistence.initialize();

      // Initialize reconnection authentication
      this.reconnectionAuth = new ReconnectionAuth({
        peerId: this.identity.uuid,
        displayName: this.identity.displayName
      });
      await this.reconnectionAuth.initialize();

      // Initialize master reconnection strategy
      this.masterReconnect = new MasterReconnectionStrategy(
        this.identity,
        this.router,
        this, // peerManager (this)
        this.peerPersistence,
        this.reconnectionAuth
      );

      // Initialize network change detector
      const reconnectorAdapter = {
        handleIpChange: async () => {
          return await this.masterReconnect.handleIpChange();
        }
      };

      this.networkDetector = new NetworkChangeDetector(reconnectorAdapter);
      this.networkDetector.initialize();

      // Register reconnection message handlers now that everything is initialized
      this.registerReconnectionHandlers();

      // Mark as ready
      this.reconnectionReady = true;

      // Start periodic announcements
      this.masterReconnect.announcements.startPeriodicAnnouncements(120000); // 2 minutes

      return true;
    } catch (error) {
      console.error('[Mesh] Failed to initialize reconnection system:', error);
      this.reconnectionEnabled = false;
      this.reconnectionReady = false;
      return false;
    }
  }

  // Register reconnection message handlers
  registerReconnectionHandlers() {
    // Announcement handlers
    this.router.on('peer_announcement', (msg) => {
      if (this.masterReconnect && this.masterReconnect.announcements) {
        this.masterReconnect.announcements.handlePeerAnnouncement(msg);
      }
    });

    this.router.on('ip_change_announcement', (msg) => {
      if (this.masterReconnect && this.masterReconnect.announcements) {
        this.masterReconnect.announcements.handleIpChange(msg);
      }
    });

    // Relay reconnection handlers
    this.router.on('reconnect_offer', (msg) => {
      if (this.masterReconnect && this.masterReconnect.meshReconnect) {
        this.masterReconnect.meshReconnect.handleReconnectOffer(msg);
      }
    });

    this.router.on('reconnect_answer', (msg) => {
      if (this.masterReconnect && this.masterReconnect.meshReconnect) {
        this.masterReconnect.meshReconnect.handleReconnectAnswer(msg);
      }
    });

    this.router.on('reconnect_rejection', (msg) => {
      if (this.masterReconnect && this.masterReconnect.meshReconnect) {
        this.masterReconnect.meshReconnect.handleReconnectRejection(msg);
      }
    });

    this.router.on('path_query', (msg) => {
      if (this.masterReconnect && this.masterReconnect.meshReconnect) {
        this.masterReconnect.meshReconnect.handlePathQuery(msg);
      }
    });

    this.router.on('path_response', (msg) => {
      if (this.masterReconnect && this.masterReconnect.meshReconnect) {
        this.masterReconnect.meshReconnect.handlePathResponse(msg);
      }
    });

    // Topology discovery handlers (optional)
    if (this.masterReconnect.topology) {
      this.router.on('topology_request', (msg) => {
        this.masterReconnect.topology.handleTopologyRequest(msg);
      });

      this.router.on('topology_response', (msg) => {
        this.masterReconnect.topology.handleTopologyResponse(msg);
      });
    }

    // Reconnection credentials exchange handlers
    this.router.on('reconnection_offer', async (msg) => {
      await this.handleReconnectionOffer(msg);
    });

    this.router.on('reconnection_answer', async (msg) => {
      await this.handleReconnectionAnswer(msg);
    });

    // Identity exchange handler
    this.router.on('identity_exchange', async (msg) => {
      if (this.reconnectionAuth) {
        try {
          const result = await this.reconnectionAuth.handleIdentityExchange(
            msg.payload,
            msg.senderId
          );
          if (result.valid) {
            // Update stored peer with public key and shared secret
            if (this.peerPersistence) {
              const trustedPeer = this.reconnectionAuth.trustStore?.getPeer(msg.senderId);
              const sessionKey = this.reconnectionAuth.sessionKeys?.get(msg.senderId);

              if (trustedPeer && trustedPeer.signPublicKey) {
                await this.peerPersistence.updatePeerPublicKey(msg.senderId, trustedPeer.signPublicKey);
              }

              if (sessionKey && sessionKey.sharedSecret) {
                await this.peerPersistence.updatePeerSharedSecret(msg.senderId, sessionKey.sharedSecret);
              }
            }
          }
        } catch (error) {
          console.error('[Mesh] Error handling identity exchange:', error);
        }
      }
    });

  }

  // Create an offer to invite someone
  async createOffer() {
    return new Promise((resolve) => {
      const peer = new SimplePeer({
        initiator: true,
        trickle: false,
        config: ICE_CONFIG, // Use centralized ICE configuration
        sdpTransform: (sdp) => sdp.replace(/a=ice-options:trickle\s?\n/g, ''),
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
          reject(new Error('Peer is banned'));
          return;
        }

        // Store peer intent early (before connection completes)
        // This ensures we have peer data even if user refreshes during signaling
        if (this.reconnectionEnabled && this.reconnectionReady && this.peerPersistence) {
          this.peerPersistence.storePeer({
            peerId: uuid,
            userId: uuid,
            displayName: displayName,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            lastConnected: null,
            publicKey: null,
            connectionQuality: {
              latency: null,
              successRate: 0,
              connectionType: 'pending',
              lastMeasured: Date.now(),
              totalConnections: 0,
              successfulConnections: 0,
              avgUptime: 0
            },
            reconnectionAttempts: 0,
            metadata: {
              storedDuringSignaling: true
            }
          }).catch(error => {
            console.error(`[Mesh] Failed to store peer intent for ${uuid.substring(0, 8)}:`, error);
          });
        }

        const peer = new SimplePeer({
          initiator: false,
          trickle: false,
          config: ICE_CONFIG, // Use centralized ICE configuration
          sdpTransform: (sdp) => sdp.replace(/a=ice-options:trickle\s?\n/g, ''),
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
      return false;
    }

    const peer = new SimplePeer({
      initiator: true,
      trickle: false,
      config: ICE_CONFIG, // Use centralized ICE configuration
      sdpTransform: (sdp) => sdp.replace(/a=ice-options:trickle\s?\n/g, ''),
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
    if (signalType === 'offer') {
      // Create answer
      const peer = new SimplePeer({
        initiator: false,
        trickle: false,
        config: ICE_CONFIG, // Use centralized ICE configuration
        sdpTransform: (sdp) => sdp.replace(/a=ice-options:trickle\s?\n/g, ''),
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
      }
    }
  }

  _setupPeerHandlers(peer, knownUUID = null) {
    peer.on('connect', async () => {
      const uuid = knownUUID || peer._peerUUID;
      if (uuid && this.peers.has(uuid)) {
        const peerData = this.peers.get(uuid);
        peerData.status = 'connected';
        peerData.connectedAt = Date.now();

        this.peers.set(uuid, peerData);

        // Wait for reconnection system initialization if needed
        if (this.reconnectionEnabled && !this.reconnectionReady && this._initPromise) {
          try {
            await this._initPromise;
          } catch (error) {
            console.error('[Mesh] Reconnection system initialization failed during peer connect:', error);
          }
        }

        // Set up ICE connection state monitoring for disconnection detection
        if (peer._pc && this.reconnectionEnabled && this.reconnectionReady && this.masterReconnect) {
          peer._pc.addEventListener('iceconnectionstatechange', () => {
            const iceState = peer._pc.iceConnectionState;

            if (iceState === 'disconnected') {
              // Connection interrupted, trigger immediate reconnection attempt
              setTimeout(() => {
                if (peer._pc && peer._pc.iceConnectionState === 'disconnected') {
                  this.masterReconnect.handlePeerDisconnected(uuid);
                }
              }, 3000); // Wait 3s to see if connection recovers
            }
          });
        }

        // Store peer in persistence for reconnection
        if (this.reconnectionEnabled && this.reconnectionReady && this.peerPersistence) {
          await this.storePeerForReconnection(uuid, peerData, peer);
        }

        // Exchange cryptographic identity
        if (this.reconnectionEnabled && this.reconnectionReady && this.reconnectionAuth) {
          try {
            await this.reconnectionAuth.exchangeIdentity(peer, uuid);

            // Update stored peer with public key from trust store
            const trustedPeer = this.reconnectionAuth.trustStore?.getPeer(uuid);
            if (trustedPeer && trustedPeer.signPublicKey && this.peerPersistence) {
              await this.peerPersistence.updatePeerPublicKey(uuid, trustedPeer.signPublicKey);
            }

            // Exchange reconnection credentials
            await this.exchangeReconnectionCredentials(peer, uuid);
          } catch (error) {
            console.error(`[Mesh] Failed to exchange identity with ${uuid.substring(0, 8)}:`, error);
          }
        }

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
          return;
        }

        if (uuid && !this.securityManager.checkRateLimit(uuid)) {
          return;
        }

        // Route message through router
        this.router.routeMessage(message, uuid);
      } catch (e) {
        console.error('[Mesh] Error parsing message:', e);
      }
    });

    peer.on('close', async () => {
      const uuid = knownUUID || peer._peerUUID;
      if (uuid && this.peers.has(uuid)) {
        // Update last seen in persistence
        if (this.reconnectionEnabled && this.peerPersistence) {
          await this.peerPersistence.updateLastSeen(uuid);
        }

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

        // Increment reconnection attempts on error
        if (this.reconnectionEnabled && this.peerPersistence) {
          this.peerPersistence.incrementReconnectionAttempts(uuid);
        }
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
      const format = message.payload.format || 'plain';
      this.onMessage(message.senderId, peerName, message.payload.text, format);
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
  sendMessage(text, format = 'markdown') {
    const sanitized = this.securityManager.sanitizeMessage(text, format);

    const chatMessage = this.router.createMessage('chat', {
      text: sanitized,
      format: format,
      version: '1.0'
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

  // Exchange reconnection credentials with peer
  async exchangeReconnectionCredentials(peer, uuid) {
    try {
      // Create a new SimplePeer instance to generate fresh reconnection credentials
      const reconnectPeer = new SimplePeer({
        initiator: true,
        trickle: false,
        config: ICE_CONFIG,
        sdpTransform: (sdp) => sdp.replace(/a=ice-options:trickle\s?\n/g, ''),
      });

      // Wait for the offer signal
      const offer = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Offer generation timeout')), 10000);

        reconnectPeer.on('signal', (signal) => {
          clearTimeout(timeout);
          resolve(signal);
        });

        reconnectPeer.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Destroy the temporary peer (we only needed the offer)
      reconnectPeer.destroy();

      // Send the reconnection offer to the peer
      const offerMessage = this.router.createMessage('reconnection_offer', {
        offer,
        timestamp: Date.now()
      }, { targetPeerId: uuid, ttl: 5 });

      this.router.routeMessage(offerMessage);

      // Store our offer temporarily (will be updated with answer when received)
      if (!this.pendingReconnectionOffers) {
        this.pendingReconnectionOffers = new Map();
      }
      this.pendingReconnectionOffers.set(uuid, { offer, timestamp: Date.now() });
    } catch (error) {
      console.error(`[Mesh] Failed to exchange reconnection credentials with ${uuid.substring(0, 8)}:`, error);
    }
  }

  // Handle incoming reconnection offer from a peer
  async handleReconnectionOffer(msg) {
    try {
      const { offer } = msg.payload;
      const fromPeerId = msg.senderId;

      // Create a new SimplePeer instance as responder
      const reconnectPeer = new SimplePeer({
        initiator: false,
        trickle: false,
        config: ICE_CONFIG,
        sdpTransform: (sdp) => sdp.replace(/a=ice-options:trickle\s?\n/g, ''),
      });

      // Wait for the answer signal
      const answer = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Answer generation timeout')), 10000);

        reconnectPeer.on('signal', (signal) => {
          clearTimeout(timeout);
          resolve(signal);
        });

        reconnectPeer.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        // Signal the offer to generate the answer
        reconnectPeer.signal(offer);
      });

      // Destroy the temporary peer
      reconnectPeer.destroy();

      // Send the answer back to the peer
      const answerMessage = this.router.createMessage('reconnection_answer', {
        answer,
        timestamp: Date.now()
      }, { targetPeerId: fromPeerId, ttl: 5 });

      this.router.routeMessage(answerMessage);

      // Store the other peer's offer and our answer for future reconnection
      const reconnectionCreds = {
        theirOffer: offer,
        ourAnswer: answer,
        timestamp: Date.now()
      };

      await this.peerPersistence.updatePeer(fromPeerId, {
        reconnectionCredentials: reconnectionCreds
      });
    } catch (error) {
      console.error(`[Mesh] Failed to handle reconnection offer from ${msg.senderId.substring(0, 8)}:`, error);
    }
  }

  // Handle incoming reconnection answer from a peer
  async handleReconnectionAnswer(msg) {
    try {
      const { answer } = msg.payload;
      const fromPeerId = msg.senderId;

      // Get our pending offer
      const pending = this.pendingReconnectionOffers?.get(fromPeerId);
      if (!pending) {
        return;
      }

      // Store our offer and their answer for future reconnection
      const reconnectionCreds = {
        ourOffer: pending.offer,
        theirAnswer: answer,
        timestamp: Date.now()
      };

      await this.peerPersistence.updatePeer(fromPeerId, {
        reconnectionCredentials: reconnectionCreds
      });

      // Clean up pending offer
      this.pendingReconnectionOffers.delete(fromPeerId);
    } catch (error) {
      console.error(`[Mesh] Failed to handle reconnection answer from ${msg.senderId.substring(0, 8)}:`, error);
    }
  }

  // Store peer for reconnection
  async storePeerForReconnection(uuid, peerData, peer) {
    try {
      // Extract ICE candidates from peer connection
      const cachedCandidates = [];

      // Extract SDP offer/answer from WebRTC connection
      let lastOffer = null;
      let lastAnswer = null;
      if (peer._pc && peer._pc.localDescription && peer._pc.remoteDescription) {
        if (peer.initiator) {
          lastOffer = { type: peer._pc.localDescription.type, sdp: peer._pc.localDescription.sdp };
          lastAnswer = { type: peer._pc.remoteDescription.type, sdp: peer._pc.remoteDescription.sdp };
        } else {
          lastAnswer = { type: peer._pc.localDescription.type, sdp: peer._pc.localDescription.sdp };
          lastOffer = { type: peer._pc.remoteDescription.type, sdp: peer._pc.remoteDescription.sdp };
        }
      }

      const peerInfo = {
        peerId: uuid,
        userId: uuid,
        displayName: peerData.displayName,
        lastSeen: Date.now(),
        lastConnected: Date.now(),

        // Cryptographic keys (peer's public key will be stored in trust store during identity exchange)
        publicKey: null,

        // Network information
        lastKnownIP: null,
        iceServers: ICE_CONFIG.iceServers,

        // Cached connection data for direct reconnection
        cachedCandidates,
        lastOffer,
        lastAnswer,
        wasInitiator: peer.initiator || false,

        // Connection quality
        connectionQuality: {
          latency: peerData.latency || null,
          successRate: 1.0, // 100% success on first connection
          connectionType: peerData.connectionType || 'unknown',
          lastMeasured: Date.now(),
          totalConnections: 1,
          successfulConnections: 1,
          avgUptime: 0 // Will be calculated on subsequent connections
        },

        // Metadata
        metadata: {
          connectedAt: peerData.connectedAt
        }
      };

      await this.peerPersistence.storePeer(peerInfo);
    } catch (error) {
      console.error('[Mesh] Failed to store peer for reconnection:', error);
    }
  }

  // Attempt to reconnect to all known peers
  async reconnectToMesh() {
    // Wait for initialization if still pending
    if (!this.reconnectionReady && this._initPromise) {
      await this._initPromise;
    }

    if (!this.reconnectionEnabled) {
      return { success: false, reason: 'disabled' };
    }

    if (!this.masterReconnect) {
      console.error('[Mesh] Reconnection system not properly initialized');
      return { success: false, reason: 'not_initialized' };
    }

    try {
      const result = await this.masterReconnect.reconnectToMesh();
      return result;
    } catch (error) {
      console.error('[Mesh] Reconnection failed:', error);
      return { success: false, reason: 'exception', error };
    }
  }

  // Reconnect to specific peer (called by announcement manager)
  async reconnectToPeer(peerId, displayName, connectionHint = null) {
    // Wait for initialization if still pending
    if (!this.reconnectionReady && this._initPromise) {
      await this._initPromise;
    }

    if (!this.reconnectionEnabled || !this.masterReconnect) {
      return { success: false, reason: 'disabled' };
    }

    // Check if already connected
    const existingPeer = this.peers.get(peerId);
    if (existingPeer && (existingPeer.status === 'connected' || existingPeer.status === 'connecting')) {
      return { success: false, reason: 'already_connected' };
    }

    try {
      // Attempt mesh relay reconnection immediately
      const result = await this.masterReconnect.meshReconnect.reconnectViaMesh(peerId, displayName);
      return result;
    } catch (error) {
      console.error(`[Mesh] Failed to reconnect to peer ${peerId.substring(0, 8)}:`, error);
      return { success: false, reason: 'exception', error };
    }
  }

  // Announce presence to mesh
  async announcePresence(reason = 'manual') {
    if (!this.reconnectionEnabled || !this.masterReconnect) {
      return false;
    }

    try {
      await this.masterReconnect.announcements.announcePresence(reason);
      return true;
    } catch (error) {
      console.error('[Mesh] Failed to announce presence:', error);
      return false;
    }
  }

  // Get reconnection system statistics
  getReconnectionStats() {
    if (!this.reconnectionEnabled || !this.masterReconnect) {
      return null;
    }

    return {
      master: this.masterReconnect.getStats(),
      persistence: {
        totalPeers: this.peerPersistence.getStats().totalPeers,
        needsCleanup: this.peerPersistence.needsCleanup()
      },
      network: this.networkDetector ? this.networkDetector.getStats() : null
    };
  }

  // Register a reconnected peer (called by reconnection managers)
  async registerReconnectedPeer(peerId, peerName, peer) {
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
  }

  // Get all connected peers (for topology)
  getAllConnectedPeers() {
    return this.peers;
  }

  // Get mesh statistics
  getStats() {
    const baseStats = {
      peers: this.getConnectedPeerCount(),
      router: this.router.getStats(),
      latency: this.latencyManager.getStats(),
      connection: this.connectionManager.getConnectionStats(),
      security: this.securityManager.getStats()
    };

    // Add reconnection stats if enabled
    if (this.reconnectionEnabled) {
      baseStats.reconnection = this.getReconnectionStats();
    }

    return baseStats;
  }

  // Disconnect all peers
  destroy() {
    // Stop subsystems
    this.router.stop();
    this.introManager.stop();
    this.latencyManager.stop();
    this.connectionManager.stop();

    // Cleanup reconnection system
    if (this.reconnectionEnabled) {
      if (this.masterReconnect) {
        this.masterReconnect.destroy();
      }
      if (this.networkDetector) {
        this.networkDetector.destroy();
      }
    }

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
