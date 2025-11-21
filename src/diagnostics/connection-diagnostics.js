/**
 * Connection Diagnostics and Monitoring System
 *
 * Comprehensive tracking of WebRTC connection establishment, ICE candidate
 * gathering, connection types, and performance metrics.
 *
 * Features:
 * - Real-time ICE state monitoring
 * - Candidate gathering and categorization
 * - Connection type detection (Direct UDP/TCP, STUN, TURN)
 * - Timing and performance metrics
 * - Global statistics and analytics
 * - Export capability for debugging
 */

import {
  detectConnectionTypeFromStats,
  ConnectionType,
  isDirectConnection,
  isRelayedConnection
} from '../config/ice-config.js';

// ============================================
// Connection Diagnostics Class
// ============================================

class ConnectionDiagnostics {
  constructor() {
    // Per-connection diagnostics data
    this.connections = new Map(); // peerId -> diagnostics object

    // Global statistics
    this.globalStats = {
      totalAttempts: 0,
      successfulConnections: 0,
      failedConnections: 0,
      totalConnectionTime: 0,
      avgConnectionTime: 0,

      // Connection type breakdown
      connectionsByType: new Map(),

      // ICE gathering stats
      avgGatheringTime: 0,
      totalGatheringTime: 0,

      // Candidate stats
      avgHostCandidates: 0,
      avgSrflxCandidates: 0,
      avgRelayCandidates: 0
    };

    // Cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Cleanup every minute
  }

  // ============================================
  // Connection Monitoring
  // ============================================

  /**
   * Start monitoring a new connection attempt
   * @param {string} peerId - Unique identifier for the peer
   * @param {SimplePeer} peer - SimplePeer instance
   * @returns {Object} Diagnostics object for this connection
   */
  startMonitoring(peerId, peer) {
    const diagnostics = {
      peerId,
      startTime: Date.now(),
      endTime: null,
      status: 'connecting', // connecting, connected, failed

      // ICE Candidate tracking
      candidates: {
        host: [],   // Direct candidates
        srflx: [],  // STUN candidates
        relay: [],  // TURN candidates
        prflx: []   // Peer reflexive
      },

      // Connection attempts and selected pair
      selectedPair: null,
      connectionAttempts: [],

      // Timing information
      timing: {
        iceGatheringStart: null,
        iceGatheringComplete: null,
        firstCandidateTime: null,
        connectionEstablished: null,
        connectionTime: null,
        gatheringTime: null
      },

      // ICE and connection states
      states: {
        iceGathering: 'new',
        iceConnection: 'new',
        connection: 'new',
        signaling: 'stable'
      },

      // State history for debugging
      stateHistory: [],

      // Errors encountered
      errors: [],

      // Final connection details
      connectionType: null,
      protocol: null,
      localCandidate: null,
      remoteCandidate: null,

      // Performance metrics
      rtt: null,
      packetsSent: 0,
      packetsReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,

      // Raw stats for export
      rawStats: null
    };

    this.connections.set(peerId, diagnostics);
    this.globalStats.totalAttempts++;

    // Set up event listeners
    this._setupPeerListeners(peerId, peer, diagnostics);

    console.log(`[Diagnostics] Started monitoring connection: ${peerId.substring(0, 8)}`);

    return diagnostics;
  }

  /**
   * Set up event listeners on the peer connection
   * @private
   */
  _setupPeerListeners(peerId, peer, diagnostics) {
    const pc = peer._pc; // Access underlying RTCPeerConnection

    if (!pc) {
      console.error('[Diagnostics] No RTCPeerConnection found for peer:', peerId.substring(0, 8));
      diagnostics.errors.push({
        time: Date.now(),
        type: 'no_rtc_peer_connection',
        message: 'SimplePeer instance has no _pc property'
      });
      return;
    }

    // ========================================
    // ICE Gathering State
    // ========================================
    const onIceGatheringStateChange = () => {
      const state = pc.iceGatheringState;
      diagnostics.states.iceGathering = state;

      this._addStateChange(diagnostics, 'iceGathering', state);

      if (state === 'gathering' && !diagnostics.timing.iceGatheringStart) {
        diagnostics.timing.iceGatheringStart = Date.now();
        console.log(`[Diagnostics] ${peerId.substring(0, 8)} - ICE gathering started`);
      }

      if (state === 'complete' && !diagnostics.timing.iceGatheringComplete) {
        diagnostics.timing.iceGatheringComplete = Date.now();
        diagnostics.timing.gatheringTime =
          diagnostics.timing.iceGatheringComplete - diagnostics.timing.iceGatheringStart;

        console.log(
          `[Diagnostics] ${peerId.substring(0, 8)} - ICE gathering completed in ${diagnostics.timing.gatheringTime}ms`
        );

        // Log candidate summary
        const hostCount = diagnostics.candidates.host.length;
        const srflxCount = diagnostics.candidates.srflx.length;
        const relayCount = diagnostics.candidates.relay.length;
        console.log(
          `[Diagnostics] ${peerId.substring(0, 8)} - Candidates: ${hostCount} host, ${srflxCount} srflx, ${relayCount} relay`
        );

        // Update global stats
        this.globalStats.totalGatheringTime += diagnostics.timing.gatheringTime;
        const successCount = this.globalStats.successfulConnections || 1;
        this.globalStats.avgGatheringTime = this.globalStats.totalGatheringTime / successCount;
      }
    };

    pc.addEventListener('icegatheringstatechange', onIceGatheringStateChange);

    // ========================================
    // ICE Connection State
    // ========================================
    const onIceConnectionStateChange = () => {
      const state = pc.iceConnectionState;
      diagnostics.states.iceConnection = state;

      this._addStateChange(diagnostics, 'iceConnection', state);

      console.log(`[Diagnostics] ${peerId.substring(0, 8)} - ICE connection state: ${state}`);

      if (state === 'connected' || state === 'completed') {
        diagnostics.endTime = Date.now();
        diagnostics.timing.connectionEstablished = diagnostics.endTime;
        diagnostics.timing.connectionTime = diagnostics.endTime - diagnostics.startTime;
        diagnostics.status = 'connected';

        console.log(
          `[Diagnostics] ${peerId.substring(0, 8)} - ✓ Connected in ${diagnostics.timing.connectionTime}ms`
        );

        // Extract detailed connection information
        this._extractConnectionDetails(peerId, pc, diagnostics);
      }

      if (state === 'failed') {
        diagnostics.status = 'failed';
        diagnostics.endTime = Date.now();

        diagnostics.errors.push({
          time: Date.now(),
          type: 'ice_failed',
          message: 'ICE connection failed'
        });

        console.error(`[Diagnostics] ${peerId.substring(0, 8)} - ✗ ICE connection failed`);

        this.globalStats.failedConnections++;
      }

      if (state === 'disconnected') {
        console.warn(`[Diagnostics] ${peerId.substring(0, 8)} - ICE connection disconnected`);

        diagnostics.errors.push({
          time: Date.now(),
          type: 'ice_disconnected',
          message: 'ICE connection disconnected'
        });
      }
    };

    pc.addEventListener('iceconnectionstatechange', onIceConnectionStateChange);

    // ========================================
    // Connection State
    // ========================================
    const onConnectionStateChange = () => {
      const state = pc.connectionState;
      diagnostics.states.connection = state;

      this._addStateChange(diagnostics, 'connection', state);

      console.log(`[Diagnostics] ${peerId.substring(0, 8)} - Connection state: ${state}`);

      if (state === 'failed') {
        diagnostics.status = 'failed';
        diagnostics.errors.push({
          time: Date.now(),
          type: 'connection_failed',
          message: 'RTCPeerConnection failed'
        });
      }
    };

    pc.addEventListener('connectionstatechange', onConnectionStateChange);

    // ========================================
    // Signaling State
    // ========================================
    const onSignalingStateChange = () => {
      const state = pc.signalingState;
      diagnostics.states.signaling = state;

      this._addStateChange(diagnostics, 'signaling', state);

      console.log(`[Diagnostics] ${peerId.substring(0, 8)} - Signaling state: ${state}`);
    };

    pc.addEventListener('signalingstatechange', onSignalingStateChange);

    // ========================================
    // ICE Candidate
    // ========================================
    const onIceCandidate = (event) => {
      if (event.candidate) {
        const candidate = event.candidate;

        if (!diagnostics.timing.firstCandidateTime) {
          diagnostics.timing.firstCandidateTime = Date.now();
        }

        // Parse and categorize candidate
        const candidateInfo = this._parseCandidateString(candidate.candidate);
        const type = candidate.type || candidateInfo.type;
        const protocol = candidate.protocol || candidateInfo.protocol;
        const port = candidate.port || candidateInfo.port;
        const address = candidate.address || candidateInfo.address;

        const candidateData = {
          candidate: candidate.candidate,
          type: type,
          protocol: protocol,
          port: port,
          address: address,
          priority: candidate.priority,
          relatedAddress: candidate.relatedAddress,
          relatedPort: candidate.relatedPort,
          timestamp: Date.now()
        };

        // Add to appropriate category
        if (diagnostics.candidates[type]) {
          diagnostics.candidates[type].push(candidateData);
        }

        console.log(
          `[Diagnostics] ${peerId.substring(0, 8)} - ICE candidate: ${type} ${protocol} ${address || 'hidden'}:${port || '?'} (priority: ${candidate.priority})`
        );
      } else {
        // All candidates gathered
        console.log(`[Diagnostics] ${peerId.substring(0, 8)} - All ICE candidates gathered`);
      }
    };

    pc.addEventListener('icecandidate', onIceCandidate);

    // Store event listeners for cleanup
    diagnostics._eventListeners = {
      pc,
      onIceGatheringStateChange,
      onIceConnectionStateChange,
      onConnectionStateChange,
      onSignalingStateChange,
      onIceCandidate
    };
  }

  /**
   * Parse ICE candidate string
   * @private
   */
  _parseCandidateString(candidateString) {
    // Example: "candidate:842163049 1 udp 1677729535 192.168.1.100 54321 typ host"
    const parts = candidateString.split(' ');
    const result = {
      type: 'unknown',
      protocol: 'unknown',
      address: null,
      port: null
    };

    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'typ' && i + 1 < parts.length) {
        result.type = parts[i + 1];
      }
      if (i === 2) {
        result.protocol = parts[i].toLowerCase();
      }
      if (i === 4) {
        result.address = parts[i];
      }
      if (i === 5) {
        result.port = parseInt(parts[i], 10);
      }
    }

    return result;
  }

  /**
   * Add state change to history
   * @private
   */
  _addStateChange(diagnostics, stateType, newState) {
    diagnostics.stateHistory.push({
      time: Date.now(),
      type: stateType,
      state: newState
    });
  }

  /**
   * Extract detailed connection information from stats
   * @private
   */
  async _extractConnectionDetails(peerId, pc, diagnostics) {
    try {
      const stats = await pc.getStats();
      diagnostics.rawStats = stats;

      // Detect connection type from stats
      const { connectionType, localCandidate, remoteCandidate, selectedPair } =
        detectConnectionTypeFromStats(stats);

      diagnostics.connectionType = connectionType;
      diagnostics.localCandidate = localCandidate;
      diagnostics.remoteCandidate = remoteCandidate;
      diagnostics.selectedPair = selectedPair;

      if (localCandidate) {
        diagnostics.protocol = localCandidate.protocol;
      }

      // Extract performance metrics
      stats.forEach((report) => {
        if (report.type === 'transport') {
          diagnostics.rtt = report.currentRoundTripTime;
        }

        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          diagnostics.packetsSent = report.packetsSent || 0;
          diagnostics.packetsReceived = report.packetsReceived || 0;
          diagnostics.bytesSent = report.bytesSent || 0;
          diagnostics.bytesReceived = report.bytesReceived || 0;
        }
      });

      // Update global statistics
      this.globalStats.successfulConnections++;
      this.globalStats.totalConnectionTime += diagnostics.timing.connectionTime;
      this.globalStats.avgConnectionTime =
        this.globalStats.totalConnectionTime / this.globalStats.successfulConnections;

      // Update connection type stats
      const connTypeName = connectionType.name;
      this.globalStats.connectionsByType.set(
        connTypeName,
        (this.globalStats.connectionsByType.get(connTypeName) || 0) + 1
      );

      // Log connection details
      console.log(`[Diagnostics] ${peerId.substring(0, 8)} - Connection type: ${connectionType.name}`);
      console.log(`[Diagnostics] ${peerId.substring(0, 8)} - Protocol: ${diagnostics.protocol}`);

      if (isDirectConnection(connectionType)) {
        console.log(
          `[Diagnostics] ${peerId.substring(0, 8)} - ✓ Direct P2P connection established!`
        );
      } else if (isRelayedConnection(connectionType)) {
        console.log(`[Diagnostics] ${peerId.substring(0, 8)} - ⚠ Using TURN relay`);
      }

      if (diagnostics.rtt) {
        console.log(
          `[Diagnostics] ${peerId.substring(0, 8)} - RTT: ${(diagnostics.rtt * 1000).toFixed(1)}ms`
        );
      }
    } catch (error) {
      console.error(`[Diagnostics] Failed to extract connection details:`, error);
      diagnostics.errors.push({
        time: Date.now(),
        type: 'stats_extraction_failed',
        message: error.message
      });
    }
  }

  // ============================================
  // Data Retrieval
  // ============================================

  /**
   * Get diagnostics for a specific peer
   * @param {string} peerId - Peer identifier
   * @returns {Object|null} Diagnostics object or null
   */
  getDiagnostics(peerId) {
    return this.connections.get(peerId) || null;
  }

  /**
   * Get global statistics
   * @returns {Object} Global statistics
   */
  getGlobalStats() {
    return {
      ...this.globalStats,
      successRate:
        this.globalStats.totalAttempts > 0
          ? ((this.globalStats.successfulConnections / this.globalStats.totalAttempts) * 100).toFixed(1)
          : 0,
      connectionsByType: Array.from(this.globalStats.connectionsByType.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
    };
  }

  /**
   * Get summary of all connections
   * @returns {Object} Summary statistics
   */
  getSummary() {
    const allConnections = Array.from(this.connections.values());

    return {
      total: allConnections.length,
      connected: allConnections.filter((d) => d.status === 'connected').length,
      failed: allConnections.filter((d) => d.status === 'failed').length,
      connecting: allConnections.filter((d) => d.status === 'connecting').length,

      byType: this._groupByConnectionType(allConnections),
      avgConnectionTime: Math.round(this.globalStats.avgConnectionTime),
      avgGatheringTime: Math.round(this.globalStats.avgGatheringTime),

      candidateStats: this._getCandidateStats(allConnections)
    };
  }

  /**
   * Group connections by type
   * @private
   */
  _groupByConnectionType(connections) {
    const grouped = {};
    connections.forEach((conn) => {
      if (conn.connectionType) {
        const typeName = conn.connectionType.name;
        grouped[typeName] = (grouped[typeName] || 0) + 1;
      }
    });
    return grouped;
  }

  /**
   * Calculate candidate statistics
   * @private
   */
  _getCandidateStats(connections) {
    const stats = {
      avgHostCandidates: 0,
      avgSrflxCandidates: 0,
      avgRelayCandidates: 0,
      totalCandidates: 0
    };

    if (connections.length === 0) return stats;

    connections.forEach((conn) => {
      stats.avgHostCandidates += conn.candidates.host.length;
      stats.avgSrflxCandidates += conn.candidates.srflx.length;
      stats.avgRelayCandidates += conn.candidates.relay.length;
    });

    const count = connections.length;
    stats.avgHostCandidates = (stats.avgHostCandidates / count).toFixed(1);
    stats.avgSrflxCandidates = (stats.avgSrflxCandidates / count).toFixed(1);
    stats.avgRelayCandidates = (stats.avgRelayCandidates / count).toFixed(1);
    stats.totalCandidates =
      parseFloat(stats.avgHostCandidates) +
      parseFloat(stats.avgSrflxCandidates) +
      parseFloat(stats.avgRelayCandidates);

    return stats;
  }

  /**
   * Export diagnostics data (for debugging)
   * @param {string} [peerId] - Optional peer ID to export specific connection
   * @returns {string} JSON string of diagnostics
   */
  exportDiagnostics(peerId = null) {
    if (peerId) {
      const diag = this.connections.get(peerId);
      if (!diag) {
        return JSON.stringify({ error: 'Peer not found' }, null, 2);
      }

      // Remove circular references and event listeners
      const exportData = {
        ...diag,
        _eventListeners: undefined,
        rawStats: diag.rawStats ? '(Raw stats available but not exported)' : null
      };

      return JSON.stringify(exportData, null, 2);
    }

    // Export all diagnostics
    return JSON.stringify(
      {
        globalStats: this.getGlobalStats(),
        summary: this.getSummary(),
        connections: Array.from(this.connections.entries()).map(([id, data]) => ({
          peerId: id.substring(0, 8),
          status: data.status,
          connectionType: data.connectionType ? data.connectionType.name : 'Unknown',
          protocol: data.protocol,
          timing: data.timing,
          candidateCounts: {
            host: data.candidates.host.length,
            srflx: data.candidates.srflx.length,
            relay: data.candidates.relay.length
          }
        }))
      },
      null,
      2
    );
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clean up old connection data
   * @param {number} [maxAge=3600000] - Max age in milliseconds (default 1 hour)
   */
  cleanup(maxAge = 3600000) {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [peerId, data] of this.connections.entries()) {
      if (data.endTime && now - data.endTime > maxAge) {
        // Remove event listeners
        if (data._eventListeners) {
          const { pc, ...listeners } = data._eventListeners;
          if (pc) {
            Object.values(listeners).forEach((listener) => {
              // Event listeners are automatically removed when peer is destroyed
              // Just cleanup the reference
            });
          }
        }

        this.connections.delete(peerId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[Diagnostics] Cleaned up ${cleanedCount} old connection records`);
    }
  }

  /**
   * Clear all diagnostics data
   */
  clearAll() {
    this.connections.clear();
    this.globalStats = {
      totalAttempts: 0,
      successfulConnections: 0,
      failedConnections: 0,
      totalConnectionTime: 0,
      avgConnectionTime: 0,
      connectionsByType: new Map(),
      avgGatheringTime: 0,
      totalGatheringTime: 0,
      avgHostCandidates: 0,
      avgSrflxCandidates: 0,
      avgRelayCandidates: 0
    };
    console.log('[Diagnostics] All diagnostics data cleared');
  }

  /**
   * Destroy diagnostics instance
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clearAll();
  }
}

// ============================================
// Singleton Instance
// ============================================

const connectionDiagnostics = new ConnectionDiagnostics();

// Expose to window for debugging
if (typeof window !== 'undefined') {
  window.connectionDiagnostics = connectionDiagnostics;
}

export default connectionDiagnostics;
