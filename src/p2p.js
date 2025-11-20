/**
 * Simple P2P connection using SimplePeer
 */
import SimplePeer from 'simple-peer';

class P2PConnection {
  constructor() {
    this.peer = null;
    this.connected = false;
    this.onConnectCallback = null;
    this.onMessageCallback = null;
    this.onDisconnectCallback = null;
  }

  createOffer() {
    return new Promise((resolve) => {
      this.peer = new SimplePeer({
        initiator: true,
        trickle: false,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          ],
          iceTransportPolicy: 'all',
        },
      });

      this.setupHandlers();

      this.peer.on('signal', (data) => {
        const encoded = btoa(JSON.stringify(data));
        resolve(encoded);
      });
    });
  }

  async acceptOffer(encodedOffer) {
    return new Promise((resolve) => {
      const offer = JSON.parse(atob(encodedOffer));

      this.peer = new SimplePeer({
        initiator: false,
        trickle: false,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          ],
          iceTransportPolicy: 'all',
        },
      });

      this.setupHandlers();

      this.peer.on('signal', (data) => {
        const encoded = btoa(JSON.stringify(data));
        resolve(encoded);
      });

      this.peer.signal(offer);
    });
  }

  acceptAnswer(encodedAnswer) {
    const answer = JSON.parse(atob(encodedAnswer));
    this.peer.signal(answer);
  }

  setupHandlers() {
    this.peer.on('connect', () => {
      this.connected = true;
      console.log('✅ P2P connected!');
      if (this.onConnectCallback) {
        this.onConnectCallback();
      }
    });

    this.peer.on('data', (data) => {
      const message = data.toString();
      if (this.onMessageCallback) {
        this.onMessageCallback(message);
      }
    });

    this.peer.on('close', () => {
      this.connected = false;
      console.log('❌ P2P disconnected');
      if (this.onDisconnectCallback) {
        this.onDisconnectCallback();
      }
    });

    this.peer.on('error', (err) => {
      console.error('P2P error:', err);
    });
  }

  send(message) {
    if (this.peer && this.connected) {
      this.peer.send(message);
      return true;
    }
    return false;
  }

  disconnect() {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
      this.connected = false;
    }
  }

  onConnect(callback) {
    this.onConnectCallback = callback;
  }

  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  onDisconnect(callback) {
    this.onDisconnectCallback = callback;
  }
}

export default new P2PConnection();
