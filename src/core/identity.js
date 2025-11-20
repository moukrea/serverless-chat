/**
 * Identity and token management
 */
import { generateKeyPair, signJWT, decodeJWT, verifyJWT } from '../utils/crypto.js';

// Configuration
export const CONFIG = {
  ACCESS_TOKEN_LIFETIME: 6 * 60 * 60, // 6 hours in seconds
  REFRESH_TOKEN_LIFETIME: 7 * 24 * 60 * 60, // 7 days in seconds
  TOKEN_REFRESH_THRESHOLD: 2 * 60 * 60, // Refresh when 2 hours left
  TOKEN_GRACE_PERIOD: 60 * 60, // Accept tokens 1 hour after expiry
  DATA_VERSION: 'v3.1',
};

class IdentityManager {
  constructor() {
    this.keys = null;
    this.accessToken = null;
    this.refreshToken = null;
    this.peerId = null;
    this.approvedPeers = {};
  }

  async initialize() {
    // Version check - clear old data
    const dataVersion = localStorage.getItem('meshDataVersion');
    if (dataVersion !== CONFIG.DATA_VERSION) {
      console.log('Clearing old mesh data for version upgrade');
      this.clearAllData();
      localStorage.setItem('meshDataVersion', CONFIG.DATA_VERSION);
    }

    // Load approved peers
    this.approvedPeers = JSON.parse(localStorage.getItem('meshApprovedPeers') || '{}');

    // Load or create identity
    await this.loadOrCreateIdentity();
  }

  async loadOrCreateIdentity() {
    const stored = localStorage.getItem('meshIdentity');

    if (stored) {
      const data = JSON.parse(stored);
      this.keys = data.keys;
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.peerId = data.peerId;

      // Check if tokens need refresh
      const accessPayload = decodeJWT(this.accessToken);
      if (accessPayload && accessPayload.exp < Date.now() / 1000 + CONFIG.TOKEN_REFRESH_THRESHOLD) {
        await this.refreshTokens();
      }
    } else {
      // Generate new identity
      this.peerId = Math.random().toString(36).substr(2, 4).toUpperCase();
      this.keys = await generateKeyPair();
      await this.generateTokens();

      // Self-approve: creator of swarm is automatically verified
      this.approvedPeers[this.peerId] = {
        publicKey: this.keys.publicKey,
        status: 'full',
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        approvedAt: Date.now(),
        approvedBy: 'self',
      };

      this.saveIdentity();
      this.saveApprovedPeers();

      console.log('[Identity] Self-approved as swarm creator');
    }
  }

  async generateTokens() {
    const now = Math.floor(Date.now() / 1000);

    this.accessToken = await signJWT(
      {
        sub: this.peerId,
        type: 'access',
        iat: now,
        exp: now + CONFIG.ACCESS_TOKEN_LIFETIME,
      },
      this.keys.privateKey
    );

    this.refreshToken = await signJWT(
      {
        sub: this.peerId,
        type: 'refresh',
        iat: now,
        exp: now + CONFIG.REFRESH_TOKEN_LIFETIME,
      },
      this.keys.privateKey
    );
  }

  async refreshTokens() {
    await this.generateTokens();
    this.saveIdentity();
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
    };
  }

  saveIdentity() {
    localStorage.setItem(
      'meshIdentity',
      JSON.stringify({
        peerId: this.peerId,
        keys: this.keys,
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
      })
    );
  }

  async verifyPeerToken(peerId, token, type = 'access') {
    const peerData = this.approvedPeers[peerId];
    if (!peerData || !peerData.publicKey) {
      return { valid: false, reason: 'unknown_peer' };
    }

    const payload = await verifyJWT(token, peerData.publicKey);
    if (!payload) {
      return { valid: false, reason: 'invalid_signature' };
    }

    if (payload.sub !== peerId) {
      return { valid: false, reason: 'wrong_subject' };
    }

    if (payload.type !== type) {
      return { valid: false, reason: 'wrong_type' };
    }

    const now = Date.now() / 1000;
    const expWithGrace = payload.exp + CONFIG.TOKEN_GRACE_PERIOD;

    if (now > expWithGrace) {
      return { valid: false, reason: 'expired', payload };
    }

    if (now > payload.exp) {
      return { valid: true, reason: 'grace_period', payload };
    }

    return { valid: true, payload };
  }

  approvePeer(peerId, data) {
    this.approvedPeers[peerId] = {
      ...data,
      approvedAt: Date.now(),
    };
    this.saveApprovedPeers();
  }

  updatePeerTokens(peerId, accessToken, refreshToken) {
    if (this.approvedPeers[peerId]) {
      this.approvedPeers[peerId].accessToken = accessToken;
      this.approvedPeers[peerId].refreshToken = refreshToken;
      this.saveApprovedPeers();
    }
  }

  removePeer(peerId) {
    delete this.approvedPeers[peerId];
    this.saveApprovedPeers();
  }

  saveApprovedPeers() {
    localStorage.setItem('meshApprovedPeers', JSON.stringify(this.approvedPeers));
  }

  clearAllData() {
    localStorage.removeItem('meshIdentity');
    localStorage.removeItem('meshApprovedPeers');
    localStorage.removeItem('meshPassphrase');
    localStorage.removeItem('meshPeerId');
    localStorage.removeItem('meshKnownPeers');
    localStorage.removeItem('meshDHTPassphrase');
  }

  getTokenStatus() {
    const payload = decodeJWT(this.accessToken);
    if (!payload) return null;

    const now = Date.now() / 1000;
    const remaining = payload.exp - now;

    return {
      remaining,
      hours: Math.floor(remaining / 3600),
      minutes: Math.floor((remaining % 3600) / 60),
      needsRefresh: remaining < CONFIG.TOKEN_REFRESH_THRESHOLD,
      expired: remaining <= 0,
    };
  }
}

export default new IdentityManager();
