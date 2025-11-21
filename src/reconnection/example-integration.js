/**
 * Example Integration of MasterReconnectionStrategy
 *
 * This file demonstrates how to integrate the master reconnection strategy
 * into your main application (app.js). Copy relevant parts into your app.
 *
 * @example
 * // In your app.js, import this or copy the patterns:
 * import { initializeReconnectionSystem } from './reconnection/example-integration.js';
 */

import MasterReconnectionStrategy from './master-reconnection.js';
import ReconnectionAuth from '../reconnection-auth.js';
import peerPersistence from '../storage/peer-persistence.js';

// =============================================================================
// EXAMPLE 1: Basic Integration
// =============================================================================

class MeshNetworkWithReconnection {
  constructor(identity) {
    this.identity = identity;

    // Initialize core components
    this.router = new MessageRouter(identity);
    this.peerManager = new PeerManager();

    // Initialize reconnection manager
    this.reconnectionManager = new ReconnectionManager(
      this.identity,
      this.router,
      this.peerManager,
      peerPersistence
    );

    // Connect components
    this.router.setPeerManager(this.peerManager);

    // Set up event handlers
    this.setupEventHandlers();

    console.log('[Mesh] Initialized with reconnection support');
  }

  setupEventHandlers() {
    // Handle peer disconnection
    this.peerManager.on('peer:disconnect', (peerId, peerName) => {
      console.log(`[Mesh] Peer ${peerName} disconnected`);

      // Store peer data before it's lost
      this.storePeerForReconnection(peerId, peerName);

      // Attempt automatic reconnection after a delay
      this.scheduleReconnection(peerId, peerName, 5000);
    });

    // Handle successful reconnection
    this.peerManager.on('peer:reconnected', (peerId, peerName) => {
      console.log(`[Mesh] Successfully reconnected to ${peerName}`);

      // Update UI
      this.updateUIForReconnection(peerId, peerName);

      // Update persistence
      peerPersistence.updateLastSeen(peerId);
    });
  }

  async storePeerForReconnection(peerId, peerName) {
    try {
      const existingPeer = await peerPersistence.getPeer(peerId);

      if (existingPeer) {
        // Update last seen
        await peerPersistence.updateLastSeen(peerId);
      } else {
        // Store new peer
        const peerData = {
          peerId,
          displayName: peerName,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          connectionQuality: {
            latency: null,
            successRate: 1.0,
            connectionType: null,
            lastMeasured: Date.now(),
            totalConnections: 1,
            successfulConnections: 1,
            avgUptime: 0
          }
        };

        await peerPersistence.storePeer(peerData);
      }
    } catch (error) {
      console.error('[Mesh] Failed to store peer:', error);
    }
  }

  async scheduleReconnection(peerId, peerName, delay) {
    console.log(`[Mesh] Scheduling reconnection to ${peerName} in ${delay}ms...`);

    setTimeout(async () => {
      await this.attemptReconnection(peerId, peerName);
    }, delay);
  }

  async attemptReconnection(peerId, peerName) {
    console.log(`[Mesh] Attempting to reconnect to ${peerName}...`);

    const result = await this.reconnectionManager.reconnectViaMesh(
      peerId,
      peerName
    );

    if (result.success) {
      console.log(`[Mesh] Reconnection successful!`);
      return true;
    } else {
      console.log(`[Mesh] Reconnection failed: ${result.reason}`);

      // Handle specific failures
      if (result.reason === 'no_path_found') {
        // Try again later when mesh topology might have changed
        this.scheduleReconnection(peerId, peerName, 30000); // 30 seconds
      }

      return false;
    }
  }

  updateUIForReconnection(peerId, peerName) {
    // Update UI to show peer is back online
    const peerElement = document.querySelector(`[data-peer-id="${peerId}"]`);
    if (peerElement) {
      peerElement.classList.remove('disconnected');
      peerElement.classList.add('connected', 'reconnected');

      // Show reconnection notification
      this.showNotification(`${peerName} reconnected`, 'success');
    }
  }

  showNotification(message, type = 'info') {
    console.log(`[Notification ${type}] ${message}`);
    // Implement your notification system here
  }

  async getReconnectionCandidates() {
    return await peerPersistence.getReconnectionCandidates({
      limit: 10,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
  }

  getStats() {
    return {
      mesh: this.router.getStats(),
      reconnection: this.reconnectionManager.getStats(),
      peers: {
        connected: this.peerManager.getConnectedPeerCount(),
        total: this.peerManager.peers.size
      }
    };
  }
}

// =============================================================================
// EXAMPLE 2: UI Integration with Reconnection Button
// =============================================================================

class ReconnectionUI {
  constructor(meshNetwork) {
    this.mesh = meshNetwork;
    this.reconnectionManager = meshNetwork.reconnectionManager;
  }

  /**
   * Render list of disconnected peers with reconnect buttons
   */
  async renderDisconnectedPeers() {
    const candidates = await this.mesh.getReconnectionCandidates();

    const container = document.getElementById('disconnected-peers');
    if (!container) return;

    container.innerHTML = candidates.map(candidate => `
      <div class="peer-card" data-peer-id="${candidate.peer.peerId}">
        <div class="peer-info">
          <h3>${candidate.peer.displayName}</h3>
          <p>Last seen: ${this.formatTime(candidate.peer.lastSeen)}</p>
          <p>Quality: ${candidate.score}/100</p>
          <p>Reason: ${candidate.reason}</p>
        </div>
        <button
          class="reconnect-button"
          onclick="reconnectUI.reconnectToPeer('${candidate.peer.peerId}', '${candidate.peer.displayName}')"
        >
          Reconnect
        </button>
      </div>
    `).join('');
  }

  /**
   * Handle reconnect button click
   */
  async reconnectToPeer(peerId, peerName) {
    const button = document.querySelector(
      `[data-peer-id="${peerId}"] .reconnect-button`
    );

    if (!button) return;

    // Update UI
    button.disabled = true;
    button.textContent = 'Connecting...';

    try {
      const result = await this.reconnectionManager.reconnectViaMesh(
        peerId,
        peerName
      );

      if (result.success) {
        // Success
        button.textContent = '✓ Connected';
        button.classList.add('success');

        // Remove from list after delay
        setTimeout(() => {
          this.renderDisconnectedPeers();
        }, 2000);

      } else {
        // Failed
        button.disabled = false;
        button.textContent = 'Retry';
        button.classList.add('error');

        // Show error message
        this.showError(`Failed to reconnect: ${result.reason}`);
      }

    } catch (error) {
      console.error('Reconnection error:', error);

      button.disabled = false;
      button.textContent = 'Retry';
      button.classList.add('error');

      this.showError(`Reconnection error: ${error.message}`);
    }
  }

  formatTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  showError(message) {
    // Implement your error display
    console.error(message);
  }
}

// =============================================================================
// EXAMPLE 3: Automatic Reconnection with Exponential Backoff
// =============================================================================

class AutoReconnectionStrategy {
  constructor(reconnectionManager, peerPersistence) {
    this.reconnectionManager = reconnectionManager;
    this.peerPersistence = peerPersistence;

    this.reconnectionAttempts = new Map(); // peerId -> attempt count
    this.maxAttempts = 5;
    this.baseDelay = 5000; // 5 seconds
    this.maxDelay = 300000; // 5 minutes
  }

  /**
   * Attempt reconnection with exponential backoff
   */
  async reconnectWithBackoff(peerId, peerName) {
    const attempts = this.reconnectionAttempts.get(peerId) || 0;

    if (attempts >= this.maxAttempts) {
      console.log(`[AutoReconnect] Max attempts reached for ${peerName}`);
      this.reconnectionAttempts.delete(peerId);
      return { success: false, reason: 'max_attempts' };
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.baseDelay * Math.pow(2, attempts),
      this.maxDelay
    );

    console.log(
      `[AutoReconnect] Attempt ${attempts + 1}/${this.maxAttempts} ` +
      `for ${peerName} in ${delay}ms`
    );

    await new Promise(resolve => setTimeout(resolve, delay));

    const result = await this.reconnectionManager.reconnectViaMesh(
      peerId,
      peerName
    );

    if (result.success) {
      // Success - reset attempts
      this.reconnectionAttempts.delete(peerId);
      return result;

    } else if (result.reason === 'already_connected') {
      // Already connected - reset attempts
      this.reconnectionAttempts.delete(peerId);
      return result;

    } else {
      // Failed - increment attempts and retry
      this.reconnectionAttempts.set(peerId, attempts + 1);

      // Schedule next attempt
      return await this.reconnectWithBackoff(peerId, peerName);
    }
  }

  /**
   * Reconnect to all high-priority peers
   */
  async reconnectToHighPriorityPeers() {
    const candidates = await this.peerPersistence.getReconnectionCandidates({
      limit: 5,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    console.log(`[AutoReconnect] Found ${candidates.length} high-priority peers`);

    const results = [];

    for (const candidate of candidates) {
      if (candidate.score > 70) {
        const result = await this.reconnectWithBackoff(
          candidate.peer.peerId,
          candidate.peer.displayName
        );

        results.push({
          peer: candidate.peer,
          result
        });

        // Small delay between reconnections
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return results;
  }

  /**
   * Start periodic reconnection attempts
   */
  startPeriodicReconnection(intervalMs = 60000) {
    console.log(`[AutoReconnect] Starting periodic reconnection (${intervalMs}ms)`);

    this.periodicTimer = setInterval(async () => {
      await this.reconnectToHighPriorityPeers();
    }, intervalMs);
  }

  stop() {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
    }
    this.reconnectionAttempts.clear();
  }
}

// =============================================================================
// EXAMPLE 4: Monitoring & Analytics
// =============================================================================

class ReconnectionMonitor {
  constructor(reconnectionManager) {
    this.reconnectionManager = reconnectionManager;
    this.events = [];
    this.maxEvents = 1000;
  }

  logEvent(type, data) {
    this.events.push({
      type,
      timestamp: Date.now(),
      data
    });

    // Trim old events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  async trackReconnection(peerId, peerName) {
    const startTime = Date.now();

    this.logEvent('reconnection_started', { peerId, peerName });

    const result = await this.reconnectionManager.reconnectViaMesh(
      peerId,
      peerName
    );

    const duration = Date.now() - startTime;

    this.logEvent('reconnection_completed', {
      peerId,
      peerName,
      success: result.success,
      reason: result.reason,
      duration
    });

    // Send to analytics
    this.sendToAnalytics({
      event: 'reconnection_attempt',
      peerId,
      peerName,
      success: result.success,
      reason: result.reason,
      duration
    });

    return result;
  }

  sendToAnalytics(data) {
    // Send to your analytics service
    console.log('[Analytics]', data);
  }

  getReconnectionMetrics() {
    const reconnectionEvents = this.events.filter(
      e => e.type === 'reconnection_completed'
    );

    const successful = reconnectionEvents.filter(e => e.data.success);
    const failed = reconnectionEvents.filter(e => !e.data.success);

    const avgDuration = successful.length > 0
      ? successful.reduce((sum, e) => sum + e.data.duration, 0) / successful.length
      : 0;

    return {
      totalAttempts: reconnectionEvents.length,
      successful: successful.length,
      failed: failed.length,
      successRate: reconnectionEvents.length > 0
        ? (successful.length / reconnectionEvents.length * 100).toFixed(1) + '%'
        : 'N/A',
      avgDuration: avgDuration.toFixed(0) + 'ms',
      failureReasons: this.groupFailureReasons(failed)
    };
  }

  groupFailureReasons(failedEvents) {
    const reasons = {};

    for (const event of failedEvents) {
      const reason = event.data.reason || 'unknown';
      reasons[reason] = (reasons[reason] || 0) + 1;
    }

    return reasons;
  }

  getRecentEvents(count = 10) {
    return this.events.slice(-count).reverse();
  }
}

// =============================================================================
// EXAMPLE 5: Simple PeerManager Implementation
// =============================================================================

class PeerManager {
  constructor() {
    this.peers = new Map();
    this.maxConnections = 6;
    this.eventHandlers = new Map();
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, ...args) {
    const handlers = this.eventHandlers.get(event) || [];
    for (const handler of handlers) {
      handler(...args);
    }
  }

  getConnectedPeerCount() {
    return Array.from(this.peers.values())
      .filter(p => p.status === 'connected')
      .length;
  }

  registerReconnectedPeer(peerId, peerName, peerConnection) {
    console.log(`[PeerManager] Registering reconnected peer: ${peerName}`);

    // Add to peers map
    this.peers.set(peerId, {
      peer: peerConnection,
      status: 'connected',
      displayName: peerName,
      connectedAt: Date.now(),
      reconnected: true
    });

    // Set up event handlers
    peerConnection.on('data', data => {
      this.handleData(peerId, data);
    });

    peerConnection.on('close', () => {
      this.handleClose(peerId);
    });

    peerConnection.on('error', err => {
      console.error(`[PeerManager] Error from ${peerName}:`, err);
    });

    // Emit reconnected event
    this.emit('peer:reconnected', peerId, peerName);
  }

  handleData(peerId, data) {
    try {
      const message = JSON.parse(data.toString());
      // Handle message
      this.emit('message', peerId, message);
    } catch (error) {
      console.error('[PeerManager] Failed to parse message:', error);
    }
  }

  handleClose(peerId) {
    const peerData = this.peers.get(peerId);
    if (peerData) {
      console.log(`[PeerManager] Peer ${peerData.displayName} disconnected`);

      peerData.status = 'disconnected';

      this.emit('peer:disconnect', peerId, peerData.displayName);
    }
  }
}

// =============================================================================
// EXAMPLE USAGE
// =============================================================================

// Initialize
const identity = {
  uuid: 'ABC123',
  displayName: 'Alice'
};

const mesh = new MeshNetworkWithReconnection(identity);

// Set up UI
const reconnectUI = new ReconnectionUI(mesh);

// Set up auto-reconnection
const autoReconnect = new AutoReconnectionStrategy(
  mesh.reconnectionManager,
  peerPersistence
);

// Set up monitoring
const monitor = new ReconnectionMonitor(mesh.reconnectionManager);

// Start periodic reconnection (every minute)
autoReconnect.startPeriodicReconnection(60000);

// Manual reconnection
async function manualReconnect(peerId, peerName) {
  return await monitor.trackReconnection(peerId, peerName);
}

// Get metrics
function getMetrics() {
  return {
    mesh: mesh.getStats(),
    reconnection: monitor.getReconnectionMetrics()
  };
}

// Export for use
export {
  MeshNetworkWithReconnection,
  ReconnectionUI,
  AutoReconnectionStrategy,
  ReconnectionMonitor,
  PeerManager
};
