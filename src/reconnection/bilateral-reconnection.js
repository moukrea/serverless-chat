/**
 * Bilateral Reconnection Manager
 *
 * Handles automatic reconnection between two peers that were previously connected.
 * Uses the same offer/answer mechanism as initial pairing, but triggered automatically
 * and continuously until reconnection succeeds.
 *
 * How it works:
 * - Peer A and B connect initially (manual pairing via QR code)
 * - Both store each other's info in localStorage
 * - When A refreshes browser:
 *   - A loads B's info from localStorage
 *   - A continuously generates offers and listens for B's answers
 *   - B detects A disconnected, continuously generates offers for A
 *   - When A and B discover each other's offers, they complete handshake
 *   - Connection re-established automatically
 *
 * This is identical to initial pairing, just automated and bilateral.
 */

import SimplePeer from 'simple-peer';
import ICE_CONFIG from '../config/ice-config.js';

const BILATERAL_CONFIG = {
  // How often to generate new offers for disconnected peers (milliseconds)
  OFFER_INTERVAL: 5000,  // 5 seconds

  // How long to keep trying before giving up (milliseconds)
  MAX_RETRY_DURATION: 60000,  // 1 minute

  // Maximum concurrent reconnection attempts
  MAX_CONCURRENT_ATTEMPTS: 5,

  // Storage keys
  STORAGE_PREFIX: 'bilateral_reconnect',
};

export class BilateralReconnectionManager {
  constructor(identity, peerManager, peerPersistence) {
    this.identity = identity;
    this.peerManager = peerManager;
    this.peerPersistence = peerPersistence;

    // Active reconnection attempts: peerId -> { timer, startTime, peer, offerData }
    this.activeAttempts = new Map();

    // Pending offers from disconnected peers: peerId -> offerData
    this.pendingOffers = new Map();

    this.stats = {
      totalAttempts: 0,
      successfulReconnections: 0,
      failedReconnections: 0,
    };

    console.log('[BilateralReconnect] Initialized');
  }

  /**
   * Start attempting to reconnect to a specific peer
   * This is called when a peer disconnects
   */
  async startReconnecting(peerId) {
    // Don't start if already attempting
    if (this.activeAttempts.has(peerId)) {
      console.log(`[BilateralReconnect] Already attempting reconnection to ${peerId.substring(0, 8)}`);
      return;
    }

    // Check if we've hit max concurrent attempts
    if (this.activeAttempts.size >= BILATERAL_CONFIG.MAX_CONCURRENT_ATTEMPTS) {
      console.log(`[BilateralReconnect] Max concurrent attempts reached, skipping ${peerId.substring(0, 8)}`);
      return;
    }

    // Get peer info from persistence
    const peerInfo = await this.peerPersistence.getPeer(peerId);
    if (!peerInfo) {
      console.log(`[BilateralReconnect] No stored info for ${peerId.substring(0, 8)}`);
      return;
    }

    console.log(`[BilateralReconnect] Starting reconnection to ${peerInfo.displayName}`);
    this.stats.totalAttempts++;

    const attempt = {
      peerId,
      peerName: peerInfo.displayName,
      startTime: Date.now(),
      peer: null,
      offerData: null,
      timer: null,
    };

    this.activeAttempts.set(peerId, attempt);

    // Generate first offer immediately
    await this.generateOffer(peerId);

    // Then generate new offers periodically
    attempt.timer = setInterval(async () => {
      const elapsed = Date.now() - attempt.startTime;

      // Check if we should give up
      if (elapsed > BILATERAL_CONFIG.MAX_RETRY_DURATION) {
        console.log(`[BilateralReconnect] Giving up on ${peerInfo.displayName} after ${elapsed}ms`);
        this.stopReconnecting(peerId, false);
        return;
      }

      // Check if peer reconnected through another means
      if (this.peerManager.peers.has(peerId)) {
        console.log(`[BilateralReconnect] Peer ${peerInfo.displayName} already reconnected`);
        this.stopReconnecting(peerId, true);
        return;
      }

      // Generate new offer
      await this.generateOffer(peerId);
    }, BILATERAL_CONFIG.OFFER_INTERVAL);
  }

  /**
   * Generate a new offer for a peer
   * Stores the offer in localStorage so the other peer can find it
   */
  async generateOffer(peerId) {
    const attempt = this.activeAttempts.get(peerId);
    if (!attempt) return;

    console.log(`[BilateralReconnect] Generating offer for ${attempt.peerName}`);

    try {
      // Create WebRTC peer as initiator
      const peer = new SimplePeer({
        initiator: true,
        trickle: false,
        config: ICE_CONFIG,
      });

      // Wait for signal (offer)
      const offerData = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Offer generation timeout'));
        }, 10000); // 10 second timeout

        peer.on('signal', (signal) => {
          clearTimeout(timeout);
          resolve({
            signal,
            fromPeerId: this.identity.uuid,
            fromName: this.identity.displayName,
            timestamp: Date.now(),
          });
        });

        peer.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Store offer in localStorage for the other peer to find
      const offerKey = `${BILATERAL_CONFIG.STORAGE_PREFIX}:offer:${peerId}:from:${this.identity.uuid}`;
      localStorage.setItem(offerKey, JSON.stringify(offerData));

      // Update attempt
      attempt.peer = peer;
      attempt.offerData = offerData;

      // Set up peer handlers
      this.setupPeerHandlers(peer, peerId, attempt.peerName);

      // Check if the other peer has posted an answer for us
      await this.checkForAnswer(peerId, peer);

    } catch (error) {
      console.error(`[BilateralReconnect] Error generating offer for ${attempt.peerName}:`, error);
    }
  }

  /**
   * Check if the other peer has posted an answer in localStorage
   */
  async checkForAnswer(peerId, peer) {
    const answerKey = `${BILATERAL_CONFIG.STORAGE_PREFIX}:answer:${this.identity.uuid}:from:${peerId}`;
    const answerJson = localStorage.getItem(answerKey);

    if (!answerJson) return;

    try {
      const answerData = JSON.parse(answerJson);

      // Check if answer is fresh (< 30 seconds old)
      const age = Date.now() - answerData.timestamp;
      if (age > 30000) {
        localStorage.removeItem(answerKey);
        return;
      }

      console.log(`[BilateralReconnect] Found answer from ${peerId.substring(0, 8)}, completing connection`);

      // Signal the answer to our peer
      peer.signal(answerData.signal);

      // Clean up the answer
      localStorage.removeItem(answerKey);

    } catch (error) {
      console.error(`[BilateralReconnect] Error processing answer:`, error);
      localStorage.removeItem(answerKey);
    }
  }

  /**
   * Check for offers from disconnected peers
   * This is called periodically to see if any peer is trying to reconnect to us
   */
  async checkForIncomingOffers() {
    // Get all peers we know about
    const allPeers = await this.peerPersistence.queryPeers({ limit: 100 });

    for (const peerInfo of allPeers) {
      const peerId = peerInfo.peerId;

      // Skip if already connected
      if (this.peerManager.peers.has(peerId)) continue;

      // Check if this peer has posted an offer for us
      const offerKey = `${BILATERAL_CONFIG.STORAGE_PREFIX}:offer:${this.identity.uuid}:from:${peerId}`;
      const offerJson = localStorage.getItem(offerKey);

      if (!offerJson) continue;

      try {
        const offerData = JSON.parse(offerJson);

        // Check if offer is fresh (< 30 seconds old)
        const age = Date.now() - offerData.timestamp;
        if (age > 30000) {
          localStorage.removeItem(offerKey);
          continue;
        }

        console.log(`[BilateralReconnect] Found offer from ${peerInfo.displayName}, generating answer`);

        // Accept the offer and generate answer
        await this.acceptOffer(peerId, peerInfo.displayName, offerData);

        // Clean up the offer
        localStorage.removeItem(offerKey);

      } catch (error) {
        console.error(`[BilateralReconnect] Error processing offer from ${peerId.substring(0, 8)}:`, error);
        localStorage.removeItem(offerKey);
      }
    }
  }

  /**
   * Accept an offer and generate an answer
   */
  async acceptOffer(peerId, peerName, offerData) {
    console.log(`[BilateralReconnect] Accepting offer from ${peerName}`);

    try {
      // Create WebRTC peer as responder
      const peer = new SimplePeer({
        initiator: false,
        trickle: false,
        config: ICE_CONFIG,
      });

      // Wait for signal (answer)
      const answerData = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Answer generation timeout'));
        }, 10000); // 10 second timeout

        peer.on('signal', (signal) => {
          clearTimeout(timeout);
          resolve({
            signal,
            fromPeerId: this.identity.uuid,
            fromName: this.identity.displayName,
            timestamp: Date.now(),
          });
        });

        peer.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        // Signal the offer to trigger answer generation
        peer.signal(offerData.signal);
      });

      // Store answer in localStorage for the other peer to find
      const answerKey = `${BILATERAL_CONFIG.STORAGE_PREFIX}:answer:${peerId}:from:${this.identity.uuid}`;
      localStorage.setItem(answerKey, JSON.stringify(answerData));

      // Set up peer handlers
      this.setupPeerHandlers(peer, peerId, peerName);

    } catch (error) {
      console.error(`[BilateralReconnect] Error accepting offer from ${peerName}:`, error);
    }
  }

  /**
   * Set up WebRTC peer event handlers
   */
  setupPeerHandlers(peer, peerId, peerName) {
    peer.on('connect', () => {
      console.log(`[BilateralReconnect] Successfully reconnected to ${peerName}!`);

      // Stop reconnection attempts
      this.stopReconnecting(peerId, true);

      // Register peer with mesh
      this.peerManager.registerReconnectedPeer(peerId, peerName, peer);

      this.stats.successfulReconnections++;
    });

    peer.on('error', (err) => {
      console.error(`[BilateralReconnect] Peer error for ${peerName}:`, err.message);
      // Don't stop attempting, just wait for next offer generation
    });

    peer.on('close', () => {
      console.log(`[BilateralReconnect] Connection closed for ${peerName}`);
    });
  }

  /**
   * Stop attempting to reconnect to a peer
   */
  stopReconnecting(peerId, success = false) {
    const attempt = this.activeAttempts.get(peerId);
    if (!attempt) return;

    // Clear interval timer
    if (attempt.timer) {
      clearInterval(attempt.timer);
    }

    // Destroy peer if it exists and not connected
    if (attempt.peer && !attempt.peer.connected && !attempt.peer.destroyed) {
      attempt.peer.destroy();
    }

    // Clean up stored offers/answers
    const offerKey = `${BILATERAL_CONFIG.STORAGE_PREFIX}:offer:${peerId}:from:${this.identity.uuid}`;
    const answerKey = `${BILATERAL_CONFIG.STORAGE_PREFIX}:answer:${this.identity.uuid}:from:${peerId}`;
    localStorage.removeItem(offerKey);
    localStorage.removeItem(answerKey);

    this.activeAttempts.delete(peerId);

    if (!success) {
      this.stats.failedReconnections++;
    }
  }

  /**
   * Start monitoring for disconnected peers
   * Should be called on app startup after loading peer list
   */
  async startMonitoring() {
    console.log('[BilateralReconnect] Starting monitoring for disconnected peers');

    // Check for incoming offers immediately
    await this.checkForIncomingOffers();

    // Then check periodically
    this.monitoringTimer = setInterval(async () => {
      await this.checkForIncomingOffers();
    }, BILATERAL_CONFIG.OFFER_INTERVAL);

    // Also start reconnecting to all disconnected peers
    const allPeers = await this.peerPersistence.queryPeers({ limit: 100 });
    for (const peerInfo of allPeers) {
      if (!this.peerManager.peers.has(peerInfo.peerId)) {
        await this.startReconnecting(peerInfo.peerId);
      }
    }
  }

  /**
   * Stop all monitoring and reconnection attempts
   */
  stopMonitoring() {
    console.log('[BilateralReconnect] Stopping monitoring');

    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }

    // Stop all active attempts
    for (const peerId of this.activeAttempts.keys()) {
      this.stopReconnecting(peerId, false);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeAttempts: this.activeAttempts.size,
      pendingOffers: this.pendingOffers.size,
    };
  }

  /**
   * Cleanup old offers/answers from localStorage
   */
  cleanupOldSignals() {
    const prefix = `${BILATERAL_CONFIG.STORAGE_PREFIX}:`;
    const keys = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keys.push(key);
      }
    }

    let cleaned = 0;
    for (const key of keys) {
      try {
        const data = JSON.parse(localStorage.getItem(key));
        const age = Date.now() - data.timestamp;

        // Remove if older than 1 minute
        if (age > 60000) {
          localStorage.removeItem(key);
          cleaned++;
        }
      } catch (error) {
        // Invalid data, remove it
        localStorage.removeItem(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[BilateralReconnect] Cleaned up ${cleaned} old signals`);
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    this.stopMonitoring();
    this.cleanupOldSignals();
  }
}

export default BilateralReconnectionManager;
