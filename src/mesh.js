import SimplePeer from 'simple-peer';
import MessageRouter from './mesh-router.js';
import PeerIntroductionManager from './mesh-introduction.js';
import LatencyManager from './mesh-latency.js';
import ConnectionManager from './mesh-connection.js';
import SecurityManager from './mesh-security.js';
import ICE_CONFIG from './config/ice-config.js';
import connectionDiagnostics from './diagnostics/connection-diagnostics.js';

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

    console.log('[Mesh] Network initialized with routing subsystems');
    if (this.reconnectionEnabled) {
      console.log('[Mesh] Reconnection system enabled');
    }
  }

  // Initialize reconnection system
  async initializeReconnectionSystem() {
    const startTime = Date.now();
    try {
      console.log('[Mesh] Initializing reconnection system...');

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

      const initTime = Date.now() - startTime;
      console.log(`[Mesh] Reconnection system initialized successfully in ${initTime}ms`);

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

    console.log('[Mesh] Reconnection message handlers registered');
  }

  // Create an offer to invite someone
  async createOffer() {
    return new Promise((resolve) => {
      const peer = new SimplePeer({
        initiator: true,
        trickle: false,
        config: ICE_CONFIG, // Use centralized ICE configuration
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

      // Start diagnostics monitoring
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      connectionDiagnostics.startMonitoring(tempId, peer);
      peer._diagnosticsId = tempId;

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
          config: ICE_CONFIG, // Use centralized ICE configuration
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

        // Start diagnostics monitoring
        connectionDiagnostics.startMonitoring(uuid, peer);

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
      config: ICE_CONFIG, // Use centralized ICE configuration
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

    // Start diagnostics monitoring
    connectionDiagnostics.startMonitoring(peerId, peer);

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
        config: ICE_CONFIG, // Use centralized ICE configuration
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

      // Start diagnostics monitoring
      connectionDiagnostics.startMonitoring(fromPeerId, peer);

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
    peer.on('connect', async () => {
      const uuid = knownUUID || peer._peerUUID;
      if (uuid && this.peers.has(uuid)) {
        const peerData = this.peers.get(uuid);
        peerData.status = 'connected';
        peerData.connectedAt = Date.now();

        // Transfer diagnostics data from temp ID to actual UUID
        if (peer._diagnosticsId && peer._diagnosticsId !== uuid) {
          const tempDiag = connectionDiagnostics.getDiagnostics(peer._diagnosticsId);
          if (tempDiag) {
            connectionDiagnostics.connections.set(uuid, tempDiag);
            connectionDiagnostics.connections.delete(peer._diagnosticsId);
            tempDiag.peerId = uuid;
          }
        }

        // Update connection type from diagnostics
        const diag = connectionDiagnostics.getDiagnostics(uuid);
        if (diag && diag.connectionType) {
          peerData.connectionType = diag.connectionType.name;
          console.log(
            `[Mesh] ${peerData.displayName} (${uuid.substring(0, 8)}) connected via ${diag.connectionType.name} (${diag.protocol})`
          );
        } else {
          console.log(`[Mesh] Connected to ${peerData.displayName} (${uuid.substring(0, 8)})`);
        }

        this.peers.set(uuid, peerData);

        // Store peer in persistence for reconnection
        if (this.reconnectionEnabled && this.peerPersistence) {
          await this.storePeerForReconnection(uuid, peerData, peer, diag);
        }

        // Exchange cryptographic identity
        if (this.reconnectionEnabled && this.reconnectionAuth) {
          try {
            await this.reconnectionAuth.exchangeIdentity(peer, uuid);
            console.log(`[Mesh] Identity exchanged with ${peerData.displayName}`);
          } catch (error) {
            console.warn('[Mesh] Failed to exchange identity:', error);
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

    peer.on('close', async () => {
      const uuid = knownUUID || peer._peerUUID;
      if (uuid && this.peers.has(uuid)) {
        console.log(`[Mesh] Disconnected from ${uuid.substring(0, 8)}`);

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

  // Store peer for reconnection
  async storePeerForReconnection(uuid, peerData, peer, diagnostics) {
    try {
      const peerInfo = {
        peerId: uuid,
        userId: uuid,
        displayName: peerData.displayName,
        lastSeen: Date.now(),
        lastConnected: Date.now(),

        // Cryptographic keys
        publicKey: this.identity.keys?.publicKey || null,

        // Network information
        lastKnownIP: null,
        iceServers: ICE_CONFIG.iceServers,

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
          connectedAt: peerData.connectedAt,
          diagnostics: diagnostics ? {
            connectionTime: diagnostics.timing?.connectionTime,
            protocol: diagnostics.protocol
          } : null
        }
      };

      await this.peerPersistence.storePeer(peerInfo);
      console.log(`[Mesh] Stored ${peerData.displayName} for reconnection`);
    } catch (error) {
      console.error('[Mesh] Failed to store peer for reconnection:', error);
    }
  }

  // Attempt to reconnect to all known peers
  async reconnectToMesh() {
    // Wait for initialization if still pending
    if (!this.reconnectionReady && this._initPromise) {
      console.log('[Mesh] Waiting for reconnection system initialization...');
      await this._initPromise;
    }

    if (!this.reconnectionEnabled) {
      console.warn('[Mesh] Reconnection system disabled (initialization failed)');
      return { success: false, reason: 'disabled' };
    }

    if (!this.masterReconnect) {
      console.error('[Mesh] Reconnection system not properly initialized');
      return { success: false, reason: 'not_initialized' };
    }

    console.log('[Mesh] Starting mesh reconnection...');

    try {
      const result = await this.masterReconnect.reconnectToMesh();
      console.log(`[Mesh] Reconnection complete: ${result.peersConnected || 0} peers connected via ${result.method}`);
      return result;
    } catch (error) {
      console.error('[Mesh] Reconnection failed:', error);
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
    console.log(`[Mesh] Registering reconnected peer: ${peerName}`);

    // Start diagnostics monitoring
    connectionDiagnostics.startMonitoring(peerId, peer);

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
    console.log('[Mesh] Shutting down network');

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
