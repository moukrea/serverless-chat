/**
 * Message handling and routing
 */
import identity from './identity.js';
import peerManager from './peer.js';
import dht from './dht.js';

class MessageHandler {
  constructor() {
    this.pendingVerifications = new Map();
    this.pendingRelayConnections = new Map();
    this.onChatMessageCallback = null;
    this.onVerificationMessageCallback = null;
    this.onSystemMessageCallback = null;
    this.onPeerStatusChangeCallback = null;
  }

  async handlePeerMessage(fromPeerId, message) {
    const peerApproval = identity.approvedPeers[fromPeerId];
    const isProbation = peerApproval?.status === 'probation';

    switch (message.type) {
      case 'chat':
        if (isProbation) return; // Probation peers can't send to main chat
        if (this.onChatMessageCallback) {
          this.onChatMessageCallback(message.text, message.sender);
        }
        break;

      case 'verification-chat':
        if (this.onVerificationMessageCallback) {
          this.onVerificationMessageCallback(message.text, message.sender);
        }
        break;

      case 'ping':
        peerManager.sendToPeer(fromPeerId, {
          type: 'pong',
          timestamp: message.timestamp,
        });
        break;

      case 'pong':
        peerManager.handlePong(fromPeerId, message.timestamp);
        break;

      case 'token-update':
        identity.updatePeerTokens(message.peerId, message.accessToken, message.refreshToken);
        break;

      case 'peer-list':
        await this.handlePeerList(message.peers, fromPeerId);
        break;

      case 'relay-forward':
        await this.handleRelayForward(fromPeerId, message);
        break;

      case 'status-upgrade':
        if (this.onSystemMessageCallback) {
          this.onSystemMessageCallback('You now have full mesh access!');
        }
        break;
    }
  }

  async handlePeerList(peers, fromPeerId) {
    for (const peerId of peers) {
      if (peerManager.peers.has(peerId) || peerId === identity.peerId) continue;

      const approved = identity.approvedPeers[peerId];
      if (approved && approved.status === 'full') {
        const result = await identity.verifyPeerToken(peerId, approved.accessToken);
        if (result.valid && identity.peerId < peerId) {
          this.initiateRelayConnection(peerId, fromPeerId);
        }
      }
    }
  }

  initiateRelayConnection(targetPeerId, relayPeerId) {
    if (this.pendingRelayConnections.has(targetPeerId)) return;

    if (this.onSystemMessageCallback) {
      this.onSystemMessageCallback(`Connecting to ${targetPeerId}...`);
    }

    const peer = peerManager.createPeer(targetPeerId, true);
    this.pendingRelayConnections.set(targetPeerId, { peer, relayThrough: relayPeerId });

    const checkSignal = setInterval(() => {
      if (peer._signalData) {
        clearInterval(checkSignal);
        peerManager.sendToPeer(relayPeerId, {
          type: 'relay-forward',
          targetPeer: targetPeerId,
          payload: {
            type: 'relay-offer',
            from: identity.peerId,
            signal: peer._signalData,
            accessToken: identity.accessToken,
          },
        });
      }
    }, 100);
  }

  async handleRelayForward(fromPeerId, message) {
    const targetPeerId = message.targetPeer;
    const payload = message.payload;

    if (targetPeerId === identity.peerId) {
      if (payload.type === 'relay-offer') {
        const result = await identity.verifyPeerToken(payload.from, payload.accessToken);
        if (!result.valid) {
          if (this.onSystemMessageCallback) {
            this.onSystemMessageCallback(`Rejected ${payload.from}: ${result.reason}`);
          }
          return;
        }

        const peer = peerManager.createPeer(payload.from, false);
        peer.signal(payload.signal);

        const checkSignal = setInterval(() => {
          if (peer._signalData) {
            clearInterval(checkSignal);
            peerManager.sendToPeer(fromPeerId, {
              type: 'relay-forward',
              targetPeer: payload.from,
              payload: {
                type: 'relay-answer',
                from: identity.peerId,
                signal: peer._signalData,
              },
            });
          }
        }, 100);
      } else if (payload.type === 'relay-answer') {
        const pending = this.pendingRelayConnections.get(payload.from);
        if (pending) {
          pending.peer.signal(payload.signal);
          this.pendingRelayConnections.delete(payload.from);
        }
      }
    } else if (peerManager.peers.has(targetPeerId)) {
      peerManager.sendToPeer(targetPeerId, message);
    }
  }

  async handleWireMessage(wire, message) {
    switch (message.type) {
      case 'announce':
        await this.handleAnnounce(wire, message);
        break;

      case 'request-verification':
        this.handleVerificationRequest(wire, message);
        break;

      case 'auto-approved':
        this.handleAutoApproved(wire, message);
        break;

      case 'probation-granted':
        this.handleProbationGranted(wire, message);
        break;

      case 'rejected':
        if (this.onSystemMessageCallback) {
          this.onSystemMessageCallback('Connection rejected');
        }
        break;

      case 'webrtc-offer':
        this.handleWebRTCOffer(wire, message);
        break;

      case 'webrtc-answer':
        this.handleWebRTCAnswer(message);
        break;
    }
  }

  async handleAnnounce(wire, message) {
    const remotePeerId = message.peerId;
    if (!remotePeerId || remotePeerId === identity.peerId) return;
    if (peerManager.peers.has(remotePeerId)) return;

    wire._remotePeerId = remotePeerId;
    wire._remotePublicKey = message.publicKey;
    wire._remoteAccessToken = message.accessToken;
    wire._remoteRefreshToken = message.refreshToken;

    const approved = identity.approvedPeers[remotePeerId];

    if (approved && approved.status === 'full') {
      const result = await identity.verifyPeerToken(remotePeerId, message.accessToken);

      if (result.valid) {
        identity.updatePeerTokens(remotePeerId, message.accessToken, message.refreshToken);

        if (identity.peerId < remotePeerId) {
          this.initiateDHTConnection(wire, remotePeerId);
        }
      } else {
        if (this.onSystemMessageCallback) {
          this.onSystemMessageCallback(`${remotePeerId}'s token invalid: ${result.reason}`);
        }
        identity.removePeer(remotePeerId);

        if (identity.peerId < remotePeerId) {
          dht.sendViaWire(wire, { type: 'request-verification', peerId: identity.peerId });
        }
      }
    } else {
      if (identity.peerId < remotePeerId) {
        dht.sendViaWire(wire, {
          type: 'request-verification',
          peerId: identity.peerId,
          publicKey: identity.keys.publicKey,
          accessToken: identity.accessToken,
          refreshToken: identity.refreshToken,
        });
      }
    }
  }

  handleVerificationRequest(wire, message) {
    const requesterId = message.peerId;
    const existing = identity.approvedPeers[requesterId];

    if (existing && existing.status === 'full') {
      identity.updatePeerTokens(requesterId, message.accessToken, message.refreshToken);

      dht.sendViaWire(wire, {
        type: 'auto-approved',
        publicKey: identity.keys.publicKey,
        accessToken: identity.accessToken,
        refreshToken: identity.refreshToken,
      });
    } else {
      // Bootstrap scenario: if we have no verified peers, auto-grant probation
      const hasVerifiedPeers = Object.values(identity.approvedPeers).some(
        peer => peer.status === 'full'
      );

      if (!hasVerifiedPeers) {
        console.log('[Bootstrap] No verified peers exist, auto-granting probation to', requesterId);

        identity.approvePeer(requesterId, {
          publicKey: message.publicKey,
          status: 'probation',
          accessToken: message.accessToken,
          refreshToken: message.refreshToken,
          approvedBy: identity.peerId,
        });

        dht.sendViaWire(wire, {
          type: 'probation-granted',
          publicKey: identity.keys.publicKey,
          accessToken: identity.accessToken,
          refreshToken: identity.refreshToken,
        });

        if (this.onSystemMessageCallback) {
          this.onSystemMessageCallback(
            `${requesterId} auto-granted probation (bootstrap mode) - verify before granting full access`,
            'verification'
          );
        }

        if (this.onPeerStatusChangeCallback) {
          this.onPeerStatusChangeCallback();
        }
      } else {
        // Normal scenario: add to pending for manual verification
        this.pendingVerifications.set(requesterId, {
          wire,
          publicKey: message.publicKey,
          accessToken: message.accessToken,
          refreshToken: message.refreshToken,
          timestamp: Date.now(),
        });

        if (this.onSystemMessageCallback) {
          this.onSystemMessageCallback(`${requesterId} requesting to join`);
        }

        if (this.onPeerStatusChangeCallback) {
          this.onPeerStatusChangeCallback();
        }
      }
    }
  }

  handleAutoApproved(wire, message) {
    const approverId = wire._remotePeerId;

    identity.approvePeer(approverId, {
      publicKey: message.publicKey,
      status: 'full',
      accessToken: message.accessToken,
      refreshToken: message.refreshToken,
    });

    if (this.onSystemMessageCallback) {
      this.onSystemMessageCallback(`Reconnected with ${approverId}`);
    }

    if (identity.peerId < approverId) {
      this.initiateDHTConnection(wire, approverId);
    }
  }

  handleProbationGranted(wire, message) {
    const granterId = wire._remotePeerId;

    identity.approvePeer(granterId, {
      publicKey: message.publicKey,
      status: 'full',
      accessToken: message.accessToken,
      refreshToken: message.refreshToken,
    });

    if (this.onSystemMessageCallback) {
      this.onSystemMessageCallback(`Probation granted by ${granterId} - waiting for verification`);
    }

    if (identity.peerId < granterId) {
      this.initiateDHTConnection(wire, granterId);
    }
  }

  handleWebRTCOffer(wire, message) {
    const fromPeerId = message.from;
    if (peerManager.peers.has(fromPeerId)) return;

    const peer = peerManager.createPeer(fromPeerId, false);
    peer.signal(message.signal);

    const checkSignal = setInterval(() => {
      if (peer._signalData) {
        clearInterval(checkSignal);
        dht.sendViaWire(wire, {
          type: 'webrtc-answer',
          from: identity.peerId,
          signal: peer._signalData,
        });
      }
    }, 100);
  }

  handleWebRTCAnswer(message) {
    const pending = this.pendingRelayConnections.get(message.from);
    if (pending) {
      pending.peer.signal(message.signal);
      this.pendingRelayConnections.delete(message.from);
    }
  }

  initiateDHTConnection(wire, remotePeerId) {
    if (this.pendingRelayConnections.has(remotePeerId)) return;

    const peer = peerManager.createPeer(remotePeerId, true);
    this.pendingRelayConnections.set(remotePeerId, { peer, wire });

    const checkSignal = setInterval(() => {
      if (peer._signalData) {
        clearInterval(checkSignal);
        dht.sendViaWire(wire, {
          type: 'webrtc-offer',
          from: identity.peerId,
          signal: peer._signalData,
        });
      }
    }, 100);
  }

  grantProbation(peerId) {
    const pending = this.pendingVerifications.get(peerId);
    if (!pending) return false;

    identity.approvePeer(peerId, {
      publicKey: pending.publicKey,
      status: 'probation',
      accessToken: pending.accessToken,
      refreshToken: pending.refreshToken,
      approvedBy: identity.peerId,
    });

    dht.sendViaWire(pending.wire, {
      type: 'probation-granted',
      publicKey: identity.keys.publicKey,
      accessToken: identity.accessToken,
      refreshToken: identity.refreshToken,
    });

    this.pendingVerifications.delete(peerId);

    if (this.onSystemMessageCallback) {
      this.onSystemMessageCallback(`${peerId} granted probation - verify them before full access`, 'verification');
    }

    return true;
  }

  rejectPeer(peerId) {
    const pending = this.pendingVerifications.get(peerId);
    if (pending) {
      dht.sendViaWire(pending.wire, { type: 'rejected' });
      this.pendingVerifications.delete(peerId);
    }

    identity.removePeer(peerId);
    peerManager.disconnectPeer(peerId);

    if (this.onSystemMessageCallback) {
      this.onSystemMessageCallback(`Rejected ${peerId}`);
    }
  }

  grantFullAccess(peerId) {
    if (identity.approvedPeers[peerId]) {
      identity.approvedPeers[peerId].status = 'full';
      identity.saveApprovedPeers();
    }

    peerManager.sendToPeer(peerId, { type: 'status-upgrade' });

    if (this.onSystemMessageCallback) {
      this.onSystemMessageCallback(`${peerId} granted full access`);
    }
  }

  getPendingVerifications() {
    return Array.from(this.pendingVerifications.entries());
  }

  onChatMessage(callback) {
    this.onChatMessageCallback = callback;
  }

  onVerificationMessage(callback) {
    this.onVerificationMessageCallback = callback;
  }

  onSystemMessage(callback) {
    this.onSystemMessageCallback = callback;
  }

  onPeerStatusChange(callback) {
    this.onPeerStatusChangeCallback = callback;
  }
}

export default new MessageHandler();
