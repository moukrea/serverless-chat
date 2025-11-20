/**
 * DHT-based peer discovery using WebTorrent
 */
import WebTorrent from 'webtorrent';
import { createInfoHash } from '../utils/crypto.js';

class DHTDiscovery {
  constructor() {
    this.client = null;
    this.activeTorrent = null;
    this.onWireCallback = null;
    this.passphrase = null;
  }

  async join(passphrase) {
    this.passphrase = passphrase;

    if (!this.client) {
      this.client = new WebTorrent();
    }

    const infoHash = await createInfoHash(passphrase);
    const magnetURI = `magnet:?xt=urn:btih:${infoHash}&dn=p2pmesh`;

    return new Promise((resolve, reject) => {
      this.client.add(magnetURI, { announce: [] }, torrent => {
        this.activeTorrent = torrent;

        torrent.on('wire', wire => {
          wire.use(this.createExtension());

          if (this.onWireCallback) {
            this.onWireCallback(wire, torrent);
          }
        });

        resolve(torrent);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.activeTorrent) {
          reject(new Error('DHT discovery timeout'));
        }
      }, 10000);
    });
  }

  leave() {
    if (this.activeTorrent) {
      this.activeTorrent.destroy();
      this.activeTorrent = null;
    }
    this.passphrase = null;
  }

  createExtension() {
    const self = this;
    const Extension = function (wire) {
      this._wire = wire;
    };

    Extension.prototype.name = 'p2pmesh_v3';

    Extension.prototype.onMessage = function (buf) {
      try {
        const message = JSON.parse(new TextDecoder().decode(buf));
        if (self.onMessageCallback) {
          self.onMessageCallback(this._wire, message);
        }
      } catch (e) {
        console.error('Failed to parse wire message:', e);
      }
    };

    return Extension;
  }

  sendViaWire(wire, message) {
    try {
      const ext = wire.extended('p2pmesh_v3');
      if (ext) {
        ext(new TextEncoder().encode(JSON.stringify(message)));
        return true;
      }
    } catch (e) {
      console.error('Failed to send via wire:', e);
    }
    return false;
  }

  getPeerCount() {
    return this.activeTorrent ? this.activeTorrent.numPeers : 0;
  }

  isActive() {
    return this.activeTorrent !== null;
  }

  onWire(callback) {
    this.onWireCallback = callback;
  }

  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  savePassphrase() {
    if (this.passphrase) {
      localStorage.setItem('meshPassphrase', this.passphrase);
    }
  }

  clearPassphrase() {
    localStorage.removeItem('meshPassphrase');
    this.passphrase = null;
  }

  getSavedPassphrase() {
    return localStorage.getItem('meshPassphrase');
  }
}

export default new DHTDiscovery();
