/**
 * Peer Reconnection Authentication System
 *
 * Provides cryptographic authentication for peer reconnection after IP changes.
 * Uses Ed25519 signatures, ECDH key agreement, and TOFU (Trust On First Use).
 *
 * @see /home/user/serverless-chat/PEER_RECONNECTION_PROTOCOL.md
 */

// ============================================================================
// Configuration
// ============================================================================

export const CONFIG = {
  // Timing
  ANNOUNCEMENT_VALIDITY_WINDOW: 5 * 60 * 1000,      // 5 minutes
  CLOCK_DRIFT_TOLERANCE: 60 * 1000,                 // 1 minute
  RECONNECTION_TIMEOUT: 30 * 1000,                  // 30 seconds

  // Replay protection
  NONCE_CACHE_SIZE: 10000,
  NONCE_CACHE_TTL: 60 * 60 * 1000,                  // 1 hour
  SEQUENCE_STORAGE_KEY: 'mesh_sequence_numbers',

  // Key management
  KEY_ROTATION_PERIOD: 90 * 24 * 60 * 60 * 1000,    // 90 days
  SESSION_KEY_ROTATION: 24 * 60 * 60 * 1000,        // 24 hours
  IDENTITY_STORAGE_KEY: 'mesh_reconnection_identity',
  PEER_TRUST_STORAGE_KEY: 'mesh_peer_trust',

  // Relay
  MAX_RELAY_HOPS: 3,
  RELAY_TIMEOUT: 10 * 1000,

  // Algorithms
  SIGNATURE_ALGORITHM: 'Ed25519',
  KEY_AGREEMENT_CURVE: 'P-256',
  STORAGE_ENCRYPTION_ALGORITHM: 'AES-GCM',
};

// ============================================================================
// Nonce Cache (Replay Protection)
// ============================================================================

class NonceCache {
  constructor() {
    this.cache = new Map(); // nonce -> timestamp
    this.maxSize = CONFIG.NONCE_CACHE_SIZE;
    this.expiryMs = CONFIG.NONCE_CACHE_TTL;

    // Cleanup timer
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000); // Every 5 min
  }

  has(nonce) {
    const exists = this.cache.has(nonce);

    // Clean up if expired
    if (exists) {
      const timestamp = this.cache.get(nonce);
      if (Date.now() - timestamp > this.expiryMs) {
        this.cache.delete(nonce);
        return false;
      }
    }

    return exists;
  }

  add(nonce) {
    // LRU eviction if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(nonce, Date.now());
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [nonce, timestamp] of this.cache.entries()) {
      if (now - timestamp > this.expiryMs) {
        this.cache.delete(nonce);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[NonceCache] Cleaned ${cleaned} expired nonces`);
    }
  }

  evictOldest() {
    // Find oldest entry
    const sorted = Array.from(this.cache.entries())
      .sort((a, b) => a[1] - b[1]);

    if (sorted.length > 0) {
      this.cache.delete(sorted[0][0]);
    }
  }

  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

// ============================================================================
// Cryptographic Utilities
// ============================================================================

class CryptoUtils {
  /**
   * Check if Ed25519 is natively supported
   */
  static async isEd25519Supported() {
    try {
      // Try to generate a key pair
      const keyPair = await crypto.subtle.generateKey(
        { name: 'Ed25519' },
        false,
        ['sign', 'verify']
      );
      return !!keyPair;
    } catch (e) {
      return false;
    }
  }

  /**
   * Generate Ed25519 signing key pair
   */
  static async generateSigningKeyPair() {
    const supported = await CryptoUtils.isEd25519Supported();

    if (!supported) {
      console.warn('[Crypto] Ed25519 not natively supported, using ECDSA P-256 fallback');
      return await CryptoUtils.generateECDSAKeyPair();
    }

    const keyPair = await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,  // extractable for storage
      ['sign', 'verify']
    );

    return {
      algorithm: 'Ed25519',
      publicKey: await crypto.subtle.exportKey('jwk', keyPair.publicKey),
      privateKey: await crypto.subtle.exportKey('jwk', keyPair.privateKey),
    };
  }

  /**
   * Fallback: Generate ECDSA P-256 key pair
   */
  static async generateECDSAKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );

    return {
      algorithm: 'ECDSA-P256',
      publicKey: await crypto.subtle.exportKey('jwk', keyPair.publicKey),
      privateKey: await crypto.subtle.exportKey('jwk', keyPair.privateKey),
    };
  }

  /**
   * Generate ECDH key pair for shared secrets
   */
  static async generateDHKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: CONFIG.KEY_AGREEMENT_CURVE },
      true,
      ['deriveKey', 'deriveBits']
    );

    return {
      publicKey: await crypto.subtle.exportKey('jwk', keyPair.publicKey),
      privateKey: await crypto.subtle.exportKey('jwk', keyPair.privateKey),
    };
  }

  /**
   * Sign data with private key
   */
  static async sign(data, privateKeyJWK, algorithm) {
    const key = await crypto.subtle.importKey(
      'jwk',
      privateKeyJWK,
      algorithm === 'Ed25519'
        ? { name: 'Ed25519' }
        : { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    const dataBytes = new TextEncoder().encode(
      typeof data === 'string' ? data : JSON.stringify(data)
    );

    const signature = await crypto.subtle.sign(
      algorithm === 'Ed25519'
        ? { name: 'Ed25519' }
        : { name: 'ECDSA', hash: 'SHA-256' },
      key,
      dataBytes
    );

    // Return as hex string
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Verify signature
   */
  static async verify(data, signatureHex, publicKeyJWK, algorithm) {
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        publicKeyJWK,
        algorithm === 'Ed25519'
          ? { name: 'Ed25519' }
          : { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );

      const dataBytes = new TextEncoder().encode(
        typeof data === 'string' ? data : JSON.stringify(data)
      );

      const signatureBytes = new Uint8Array(
        signatureHex.match(/.{2}/g).map(byte => parseInt(byte, 16))
      );

      const valid = await crypto.subtle.verify(
        algorithm === 'Ed25519'
          ? { name: 'Ed25519' }
          : { name: 'ECDSA', hash: 'SHA-256' },
        key,
        signatureBytes,
        dataBytes
      );

      return valid;
    } catch (e) {
      console.error('[Crypto] Verification failed:', e);
      return false;
    }
  }

  /**
   * Derive shared secret from ECDH
   */
  static async deriveSharedSecret(privateKeyJWK, publicKeyJWK) {
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      privateKeyJWK,
      { name: 'ECDH', namedCurve: CONFIG.KEY_AGREEMENT_CURVE },
      false,
      ['deriveBits']
    );

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      publicKeyJWK,
      { name: 'ECDH', namedCurve: CONFIG.KEY_AGREEMENT_CURVE },
      false,
      []
    );

    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: publicKey },
      privateKey,
      256 // 256 bits
    );

    // Return as hex string
    return Array.from(new Uint8Array(sharedBits))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Generate cryptographically secure random nonce
   */
  static generateNonce() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Generate fingerprint for public key (for out-of-band verification)
   */
  static async generateFingerprint(publicKeyJWK) {
    const keyString = JSON.stringify(publicKeyJWK);
    const keyBytes = new TextEncoder().encode(keyString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyBytes);

    const hashArray = Array.from(new Uint8Array(hashBuffer));

    // Format as 10 groups of 5 digits (like Signal safety numbers)
    return hashArray
      .map(b => b.toString(10).padStart(3, '0'))
      .join(' ')
      .match(/.{1,15}/g);
  }

  /**
   * Derive encryption key for localStorage
   */
  static async deriveStorageKey() {
    // Collect browser entropy (not secret, just for consistency)
    const entropy = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      'mesh-reconnection-v1', // Salt
    ].join('|');

    const entropyBytes = new TextEncoder().encode(entropy);
    const hashBuffer = await crypto.subtle.digest('SHA-256', entropyBytes);

    return await crypto.subtle.importKey(
      'raw',
      hashBuffer,
      CONFIG.STORAGE_ENCRYPTION_ALGORITHM,
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt data for storage
   */
  static async encryptForStorage(data) {
    const key = await CryptoUtils.deriveStorageKey();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // GCM nonce

    const dataString = typeof data === 'string' ? data : JSON.stringify(data);
    const dataBytes = new TextEncoder().encode(dataString);

    const encrypted = await crypto.subtle.encrypt(
      { name: CONFIG.STORAGE_ENCRYPTION_ALGORITHM, iv },
      key,
      dataBytes
    );

    return {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted)),
    };
  }

  /**
   * Decrypt data from storage
   */
  static async decryptFromStorage(stored) {
    const key = await CryptoUtils.deriveStorageKey();
    const iv = new Uint8Array(stored.iv);
    const data = new Uint8Array(stored.data);

    const decrypted = await crypto.subtle.decrypt(
      { name: CONFIG.STORAGE_ENCRYPTION_ALGORITHM, iv },
      key,
      data
    );

    return JSON.parse(new TextDecoder().decode(decrypted));
  }
}

// ============================================================================
// Peer Trust Store (TOFU - Trust On First Use)
// ============================================================================

class PeerTrustStore {
  constructor() {
    this.trustedPeers = new Map(); // peerId -> { signPublicKey, algorithm, firstSeen, lastSeen }
    this.load();
  }

  /**
   * Add or update peer trust
   */
  async addPeer(peerId, signPublicKey, algorithm) {
    if (this.trustedPeers.has(peerId)) {
      // Verify it's the same key (TOFU principle)
      const stored = this.trustedPeers.get(peerId);
      const storedKeyStr = JSON.stringify(stored.signPublicKey);
      const newKeyStr = JSON.stringify(signPublicKey);

      if (storedKeyStr !== newKeyStr) {
        console.error('[TrustStore] PUBLIC KEY MISMATCH DETECTED!');
        console.error(`Peer ${peerId} is using a different key than before.`);
        console.error('This could indicate a man-in-the-middle attack!');

        throw new Error('PUBLIC_KEY_MISMATCH');
      }

      // Update last seen
      stored.lastSeen = Date.now();
      this.trustedPeers.set(peerId, stored);
    } else {
      // First time seeing this peer - trust on first use
      this.trustedPeers.set(peerId, {
        signPublicKey,
        algorithm,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      });

      console.log(`[TrustStore] Added new trusted peer: ${peerId}`);
    }

    await this.save();
  }

  /**
   * Get peer's public key
   */
  getPeer(peerId) {
    return this.trustedPeers.get(peerId);
  }

  /**
   * Check if peer is trusted
   */
  isTrusted(peerId) {
    return this.trustedPeers.has(peerId);
  }

  /**
   * Remove peer
   */
  async removePeer(peerId) {
    this.trustedPeers.delete(peerId);
    await this.save();
    console.log(`[TrustStore] Removed peer: ${peerId}`);
  }

  /**
   * Get fingerprint for peer (for out-of-band verification)
   */
  async getFingerprint(peerId) {
    const peer = this.trustedPeers.get(peerId);
    if (!peer) return null;

    return await CryptoUtils.generateFingerprint(peer.signPublicKey);
  }

  /**
   * Load from localStorage
   */
  load() {
    try {
      const stored = localStorage.getItem(CONFIG.PEER_TRUST_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        this.trustedPeers = new Map(Object.entries(data));
        console.log(`[TrustStore] Loaded ${this.trustedPeers.size} trusted peers`);
      }
    } catch (e) {
      console.error('[TrustStore] Failed to load:', e);
    }
  }

  /**
   * Save to localStorage (encrypted)
   */
  async save() {
    try {
      const data = Object.fromEntries(this.trustedPeers.entries());
      const encrypted = await CryptoUtils.encryptForStorage(data);
      localStorage.setItem(CONFIG.PEER_TRUST_STORAGE_KEY, JSON.stringify(encrypted));
    } catch (e) {
      console.error('[TrustStore] Failed to save:', e);
    }
  }

  /**
   * Clear all trusted peers
   */
  async clear() {
    this.trustedPeers.clear();
    await this.save();
    console.log('[TrustStore] Cleared all trusted peers');
  }
}

// ============================================================================
// Sequence Number Tracker (Rollback Prevention)
// ============================================================================

class SequenceTracker {
  constructor() {
    this.sequences = new Map(); // peerId -> lastSeenSequence
    this.load();
  }

  /**
   * Get last seen sequence for peer
   */
  get(peerId) {
    return this.sequences.get(peerId) || 0;
  }

  /**
   * Update sequence for peer
   */
  update(peerId, sequence) {
    const current = this.get(peerId);

    if (sequence <= current) {
      console.warn(`[Sequence] Sequence number not incremented for ${peerId}: ${sequence} <= ${current}`);
      return false;
    }

    this.sequences.set(peerId, sequence);
    this.save();
    return true;
  }

  /**
   * Load from localStorage
   */
  load() {
    try {
      const stored = localStorage.getItem(CONFIG.SEQUENCE_STORAGE_KEY);
      if (stored) {
        this.sequences = new Map(Object.entries(JSON.parse(stored)));
      }
    } catch (e) {
      console.error('[Sequence] Failed to load:', e);
    }
  }

  /**
   * Save to localStorage
   */
  save() {
    try {
      const data = Object.fromEntries(this.sequences.entries());
      localStorage.setItem(CONFIG.SEQUENCE_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('[Sequence] Failed to save:', e);
    }
  }

  /**
   * Clear all sequences
   */
  clear() {
    this.sequences.clear();
    this.save();
  }
}

// ============================================================================
// Main Reconnection Authentication Manager
// ============================================================================

class ReconnectionAuth {
  constructor(identity) {
    this.identity = identity; // { peerId, displayName }

    this.signKeyPair = null;      // Ed25519 or ECDSA
    this.dhKeyPair = null;         // ECDH for session keys
    this.algorithm = null;         // 'Ed25519' or 'ECDSA-P256'
    this.sequenceCounter = 0;      // Monotonic counter for our announcements

    this.nonceCache = new NonceCache();
    this.trustStore = new PeerTrustStore();
    this.sequenceTracker = new SequenceTracker();

    this.sessionKeys = new Map();  // peerId -> { sharedSecret, dhPublicKey }
  }

  /**
   * Initialize the authentication system
   */
  async initialize() {
    console.log('[ReconnectionAuth] Initializing...');

    // Load or generate identity
    await this.loadOrCreateIdentity();

    // Check if key rotation is needed
    await this.checkKeyRotation();

    console.log(`[ReconnectionAuth] Ready (algorithm: ${this.algorithm})`);
  }

  /**
   * Load identity from storage or create new
   */
  async loadOrCreateIdentity() {
    try {
      const stored = localStorage.getItem(CONFIG.IDENTITY_STORAGE_KEY);

      if (stored) {
        const encrypted = JSON.parse(stored);
        const data = await CryptoUtils.decryptFromStorage(encrypted);

        this.signKeyPair = {
          publicKey: data.signPublicKey,
          privateKey: data.signPrivateKey,
        };
        this.dhKeyPair = {
          publicKey: data.dhPublicKey,
          privateKey: data.dhPrivateKey,
        };
        this.algorithm = data.algorithm;
        this.sequenceCounter = data.sequenceCounter || 0;
        this.created = data.created;

        console.log('[ReconnectionAuth] Loaded existing identity');
      } else {
        // Generate new identity
        const signKeys = await CryptoUtils.generateSigningKeyPair();
        const dhKeys = await CryptoUtils.generateDHKeyPair();

        this.signKeyPair = {
          publicKey: signKeys.publicKey,
          privateKey: signKeys.privateKey,
        };
        this.dhKeyPair = {
          publicKey: dhKeys.publicKey,
          privateKey: dhKeys.privateKey,
        };
        this.algorithm = signKeys.algorithm;
        this.sequenceCounter = 0;
        this.created = Date.now();

        await this.saveIdentity();

        console.log('[ReconnectionAuth] Created new identity');
      }
    } catch (e) {
      console.error('[ReconnectionAuth] Failed to load/create identity:', e);
      throw e;
    }
  }

  /**
   * Save identity to localStorage (encrypted)
   */
  async saveIdentity() {
    try {
      const data = {
        signPublicKey: this.signKeyPair.publicKey,
        signPrivateKey: this.signKeyPair.privateKey,
        dhPublicKey: this.dhKeyPair.publicKey,
        dhPrivateKey: this.dhKeyPair.privateKey,
        algorithm: this.algorithm,
        sequenceCounter: this.sequenceCounter,
        created: this.created,
      };

      const encrypted = await CryptoUtils.encryptForStorage(data);
      localStorage.setItem(CONFIG.IDENTITY_STORAGE_KEY, JSON.stringify(encrypted));
    } catch (e) {
      console.error('[ReconnectionAuth] Failed to save identity:', e);
    }
  }

  /**
   * Check if key rotation is needed
   */
  async checkKeyRotation() {
    const age = Date.now() - this.created;

    if (age > CONFIG.KEY_ROTATION_PERIOD) {
      console.log('[ReconnectionAuth] Key rotation needed');
      // TODO: Implement key rotation protocol
      // For now, just log
    }
  }

  /**
   * Exchange identity with peer (after WebRTC connection established)
   */
  async exchangeIdentity(peer, peerId) {
    console.log(`[ReconnectionAuth] Exchanging identity with ${peerId}`);

    // Send our identity
    const identityMessage = {
      type: 'identity_exchange',
      peerId: this.identity.peerId,
      displayName: this.identity.displayName,
      signPublicKey: this.signKeyPair.publicKey,
      dhPublicKey: this.dhKeyPair.publicKey,
      algorithm: this.algorithm,
      timestamp: Date.now(),
    };

    // Sign the message (proves we own the private key)
    const payload = JSON.stringify({
      peerId: identityMessage.peerId,
      signPublicKey: identityMessage.signPublicKey,
      dhPublicKey: identityMessage.dhPublicKey,
      timestamp: identityMessage.timestamp,
    });

    identityMessage.signature = await CryptoUtils.sign(
      payload,
      this.signKeyPair.privateKey,
      this.algorithm
    );

    peer.send(JSON.stringify(identityMessage));

    return identityMessage;
  }

  /**
   * Handle identity exchange from peer
   */
  async handleIdentityExchange(message, peerId) {
    console.log(`[ReconnectionAuth] Received identity exchange from ${peerId}`);

    // Verify signature
    const payload = JSON.stringify({
      peerId: message.peerId,
      signPublicKey: message.signPublicKey,
      dhPublicKey: message.dhPublicKey,
      timestamp: message.timestamp,
    });

    const valid = await CryptoUtils.verify(
      payload,
      message.signature,
      message.signPublicKey,
      message.algorithm
    );

    if (!valid) {
      console.error('[ReconnectionAuth] Invalid identity signature from', peerId);
      return { valid: false, reason: 'invalid_signature' };
    }

    // Add to trust store (TOFU)
    try {
      await this.trustStore.addPeer(
        message.peerId,
        message.signPublicKey,
        message.algorithm
      );
    } catch (e) {
      if (e.message === 'PUBLIC_KEY_MISMATCH') {
        return { valid: false, reason: 'key_mismatch', securityAlert: true };
      }
      throw e;
    }

    // Derive shared secret
    const sharedSecret = await CryptoUtils.deriveSharedSecret(
      this.dhKeyPair.privateKey,
      message.dhPublicKey
    );

    this.sessionKeys.set(message.peerId, {
      sharedSecret,
      dhPublicKey: message.dhPublicKey,
      established: Date.now(),
    });

    console.log(`[ReconnectionAuth] Identity exchange successful with ${message.peerId}`);

    return { valid: true, peerId: message.peerId };
  }

  /**
   * Create reconnection announcement
   */
  async createAnnouncement(previousConnections = []) {
    this.sequenceCounter++;
    await this.saveIdentity();

    const announcement = {
      type: 'peer_reconnection',
      peerId: this.identity.peerId,
      displayName: this.identity.displayName,
      timestamp: Date.now(),
      nonce: CryptoUtils.generateNonce(),
      sequenceNum: this.sequenceCounter,
      previousConnections,
    };

    // Create canonical payload (sorted keys for determinism)
    const payload = JSON.stringify(announcement, Object.keys(announcement).sort());

    // Sign with our private key
    announcement.signature = await CryptoUtils.sign(
      payload,
      this.signKeyPair.privateKey,
      this.algorithm
    );

    announcement.algorithm = this.algorithm;

    return announcement;
  }

  /**
   * Verify reconnection announcement
   */
  async verifyAnnouncement(announcement) {
    // 1. Check if peer is trusted
    if (!this.trustStore.isTrusted(announcement.peerId)) {
      return {
        valid: false,
        reason: 'unknown_peer',
        suggestion: 'This peer must establish initial connection first'
      };
    }

    const trustedPeer = this.trustStore.getPeer(announcement.peerId);

    // 2. Check timestamp (within acceptable window)
    const age = Date.now() - announcement.timestamp;
    const maxAge = CONFIG.ANNOUNCEMENT_VALIDITY_WINDOW + CONFIG.CLOCK_DRIFT_TOLERANCE;
    const minAge = -CONFIG.CLOCK_DRIFT_TOLERANCE;

    if (age > maxAge || age < minAge) {
      return {
        valid: false,
        reason: 'timestamp_out_of_range',
        age,
        maxAge
      };
    }

    // 3. Check nonce uniqueness (replay protection)
    if (this.nonceCache.has(announcement.nonce)) {
      return {
        valid: false,
        reason: 'nonce_reused',
        details: 'This announcement was already seen (replay attack?)'
      };
    }

    // 4. Check sequence number (rollback protection)
    const lastSequence = this.sequenceTracker.get(announcement.peerId);
    if (announcement.sequenceNum <= lastSequence) {
      return {
        valid: false,
        reason: 'sequence_number_not_incremented',
        expected: `> ${lastSequence}`,
        received: announcement.sequenceNum
      };
    }

    // 5. Verify cryptographic signature
    const payloadCopy = { ...announcement };
    delete payloadCopy.signature;
    delete payloadCopy.algorithm;

    const payload = JSON.stringify(payloadCopy, Object.keys(payloadCopy).sort());

    const validSignature = await CryptoUtils.verify(
      payload,
      announcement.signature,
      trustedPeer.signPublicKey,
      trustedPeer.algorithm
    );

    if (!validSignature) {
      return {
        valid: false,
        reason: 'invalid_signature',
        details: 'Cryptographic signature verification failed'
      };
    }

    // All checks passed!
    // Record nonce and update sequence
    this.nonceCache.add(announcement.nonce);
    this.sequenceTracker.update(announcement.peerId, announcement.sequenceNum);

    console.log(`[ReconnectionAuth] ✅ Valid announcement from ${announcement.peerId}`);

    return {
      valid: true,
      peerId: announcement.peerId,
      displayName: announcement.displayName
    };
  }

  /**
   * Create relay envelope
   */
  async createRelayEnvelope(originalAnnouncement) {
    const envelope = {
      type: 'relayed_announcement',
      relayedBy: this.identity.peerId,
      relayTimestamp: Date.now(),
      originalAnnouncement,
    };

    // Sign the relay action
    const payload = JSON.stringify({
      type: envelope.type,
      relayedBy: envelope.relayedBy,
      relayTimestamp: envelope.relayTimestamp,
      // Include hash of original to bind signature
      originalHash: await this.hashAnnouncement(originalAnnouncement),
    });

    envelope.relaySignature = await CryptoUtils.sign(
      payload,
      this.signKeyPair.privateKey,
      this.algorithm
    );

    envelope.algorithm = this.algorithm;

    return envelope;
  }

  /**
   * Verify relayed announcement
   */
  async verifyRelayedAnnouncement(envelope, depth = 0) {
    // 1. Check relay chain depth
    if (depth >= CONFIG.MAX_RELAY_HOPS) {
      return {
        valid: false,
        reason: 'relay_chain_too_long',
        maxHops: CONFIG.MAX_RELAY_HOPS
      };
    }

    // 2. Verify relay signature
    if (!this.trustStore.isTrusted(envelope.relayedBy)) {
      return {
        valid: false,
        reason: 'untrusted_relay',
        relayPeer: envelope.relayedBy
      };
    }

    const relayPeer = this.trustStore.getPeer(envelope.relayedBy);

    const relayPayload = JSON.stringify({
      type: envelope.type,
      relayedBy: envelope.relayedBy,
      relayTimestamp: envelope.relayTimestamp,
      originalHash: await this.hashAnnouncement(envelope.originalAnnouncement),
    });

    const relayValid = await CryptoUtils.verify(
      relayPayload,
      envelope.relaySignature,
      relayPeer.signPublicKey,
      relayPeer.algorithm
    );

    if (!relayValid) {
      return {
        valid: false,
        reason: 'invalid_relay_signature',
        relayPeer: envelope.relayedBy
      };
    }

    // 3. Check relay timestamp is reasonable
    const relayAge = Date.now() - envelope.relayTimestamp;
    if (relayAge > CONFIG.ANNOUNCEMENT_VALIDITY_WINDOW) {
      return {
        valid: false,
        reason: 'relay_too_old',
        age: relayAge
      };
    }

    // 4. Check relay timestamp is after original
    if (envelope.relayTimestamp < envelope.originalAnnouncement.timestamp) {
      return {
        valid: false,
        reason: 'relay_before_original'
      };
    }

    // 5. Verify original announcement
    const originalResult = await this.verifyAnnouncement(envelope.originalAnnouncement);
    if (!originalResult.valid) {
      return originalResult;
    }

    console.log(`[ReconnectionAuth] ✅ Valid relayed announcement from ${envelope.originalAnnouncement.peerId} via ${envelope.relayedBy}`);

    return {
      valid: true,
      peerId: envelope.originalAnnouncement.peerId,
      displayName: envelope.originalAnnouncement.displayName,
      relayedBy: envelope.relayedBy,
      relayDepth: depth + 1,
    };
  }

  /**
   * Hash announcement for relay signature binding
   */
  async hashAnnouncement(announcement) {
    const str = JSON.stringify(announcement, Object.keys(announcement).sort());
    const bytes = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Get our fingerprint (for out-of-band verification)
   */
  async getOurFingerprint() {
    return await CryptoUtils.generateFingerprint(this.signKeyPair.publicKey);
  }

  /**
   * Get peer fingerprint (for out-of-band verification)
   */
  async getPeerFingerprint(peerId) {
    return await this.trustStore.getFingerprint(peerId);
  }

  /**
   * Clean up
   */
  destroy() {
    this.nonceCache.destroy();
  }
}

export default ReconnectionAuth;
