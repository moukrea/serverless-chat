import SimplePeer from 'simple-peer';

// Multi-peer mesh network manager
class MeshNetwork {
  constructor(identity) {
    this.identity = identity;
    this.peers = new Map(); // uuid -> { peer, displayName, status }
    this.onMessage = null;
    this.onPeerConnect = null;
    this.onPeerDisconnect = null;
    this.onPeerUpdate = null;
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
        });
        tempPeer._peerUUID = uuid;
        tempPeer.signal(signal);
      } else {
        throw new Error('No pending peer connection found');
      }
    } catch (e) {
      console.error('Accept answer error:', e);
      throw e;
    }
  }

  _setupPeerHandlers(peer, knownUUID = null) {
    peer.on('connect', () => {
      const uuid = knownUUID || peer._peerUUID;
      if (uuid && this.peers.has(uuid)) {
        const peerData = this.peers.get(uuid);
        peerData.status = 'connected';
        this.peers.set(uuid, peerData);

        if (this.onPeerConnect) {
          this.onPeerConnect(uuid, peerData.displayName);
        }

        // Send identity announcement
        this._sendToPeer(peer, {
          type: 'identity',
          uuid: this.identity.uuid,
          displayName: this.identity.displayName,
        });

        // Share peer list
        this._sendPeerList(peer);
      }
    });

    peer.on('data', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this._handleMessage(peer, message);
      } catch (e) {
        console.error('Error parsing message:', e);
      }
    });

    peer.on('close', () => {
      const uuid = knownUUID || peer._peerUUID;
      if (uuid && this.peers.has(uuid)) {
        this.peers.delete(uuid);
        if (this.onPeerDisconnect) {
          this.onPeerDisconnect(uuid);
        }
      }
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      const uuid = knownUUID || peer._peerUUID;
      if (uuid && this.peers.has(uuid)) {
        const peerData = this.peers.get(uuid);
        peerData.status = 'error';
        this.peers.set(uuid, peerData);
      }
    });

    // Store peer temporarily if UUID not known yet
    if (!knownUUID) {
      this.peers.set('_temp', { peer, displayName: 'Connecting...', status: 'connecting' });
    }
  }

  _handleMessage(peer, message) {
    const { type, uuid, displayName } = message;

    switch (type) {
      case 'identity':
        // Update peer identity if needed
        if (uuid && this.peers.has(uuid)) {
          const peerData = this.peers.get(uuid);
          if (peerData.displayName !== displayName) {
            peerData.displayName = displayName;
            this.peers.set(uuid, peerData);
            if (this.onPeerUpdate) {
              this.onPeerUpdate(uuid, displayName);
            }
          }
        }
        break;

      case 'chat':
        if (this.onMessage) {
          this.onMessage(uuid, displayName, message.text);
        }
        break;

      case 'name_change':
        // Peer changed their display name
        if (uuid && this.peers.has(uuid)) {
          const peerData = this.peers.get(uuid);
          peerData.displayName = displayName;
          this.peers.set(uuid, peerData);
          if (this.onPeerUpdate) {
            this.onPeerUpdate(uuid, displayName);
          }
        }
        break;

      case 'peer_list':
        // Received list of other peers in the mesh (for future expansion)
        // Currently not implementing auto-discovery
        break;
    }
  }

  _sendToPeer(peer, message) {
    if (peer && !peer.destroyed) {
      peer.send(JSON.stringify(message));
    }
  }

  _sendPeerList(peer) {
    const peerList = Array.from(this.peers.entries())
      .filter(([uuid, data]) => data.status === 'connected' && uuid !== '_temp')
      .map(([uuid, data]) => ({ uuid, displayName: data.displayName }));

    this._sendToPeer(peer, {
      type: 'peer_list',
      peers: peerList,
    });
  }

  // Send a chat message to all connected peers
  sendMessage(text) {
    const message = {
      type: 'chat',
      uuid: this.identity.uuid,
      displayName: this.identity.displayName,
      text,
    };

    for (const [uuid, data] of this.peers.entries()) {
      if (data.status === 'connected' && uuid !== '_temp') {
        this._sendToPeer(data.peer, message);
      }
    }
  }

  // Broadcast display name change
  broadcastNameChange() {
    const message = {
      type: 'name_change',
      uuid: this.identity.uuid,
      displayName: this.identity.displayName,
    };

    for (const [uuid, data] of this.peers.entries()) {
      if (data.status === 'connected' && uuid !== '_temp') {
        this._sendToPeer(data.peer, message);
      }
    }
  }

  // Get all connected peers
  getConnectedPeers() {
    return Array.from(this.peers.entries())
      .filter(([uuid, data]) => data.status === 'connected' && uuid !== '_temp')
      .map(([uuid, data]) => ({
        uuid,
        displayName: this.identity.getPeerDisplayName(uuid, data.displayName),
        originalDisplayName: data.displayName,
      }));
  }

  // Disconnect all peers
  destroy() {
    for (const [uuid, data] of this.peers.entries()) {
      if (data.peer && !data.peer.destroyed) {
        data.peer.destroy();
      }
    }
    this.peers.clear();
  }
}

export default MeshNetwork;
