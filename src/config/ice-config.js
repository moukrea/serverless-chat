/**
 * Centralized ICE Configuration for WebRTC Connections
 *
 * This module provides comprehensive STUN/TURN server configuration
 * with automatic fallback through multiple connection types to ensure
 * maximum compatibility across all network environments.
 *
 * Connection Preference Order (automatic via ICE):
 * 1. Direct UDP (host candidates) - Fastest, true P2P
 * 2. Direct TCP (host candidates) - If UDP is blocked
 * 3. STUN UDP (srflx candidates) - NAT traversal via STUN
 * 4. TURN UDP :80 (relay) - Common port, high success rate
 * 5. TURN UDP :443 (relay) - HTTPS port, rarely blocked
 * 6. TURN TCP :443 (relay) - Looks like HTTPS traffic
 * 7. TURN TLS :443 (relay) - Encrypted, indistinguishable from HTTPS
 *
 * Note: ICE automatically prioritizes host > srflx > relay candidates.
 * All TURN servers are provided as fallbacks when direct connections fail.
 */

// ============================================
// Connection Type Definitions
// ============================================

/**
 * Connection type classifications with priority
 * Lower priority number = better connection (faster, lower latency)
 */
export const ConnectionType = {
  // Direct connections (no relay)
  DIRECT_UDP: {
    name: 'Direct UDP',
    priority: 1,
    category: 'host',
    description: 'True peer-to-peer UDP connection (fastest)'
  },
  DIRECT_TCP: {
    name: 'Direct TCP',
    priority: 2,
    category: 'host',
    description: 'True peer-to-peer TCP connection'
  },

  // STUN-assisted connections (NAT traversal)
  STUN_UDP: {
    name: 'STUN UDP',
    priority: 3,
    category: 'srflx',
    description: 'NAT-traversed UDP via STUN server'
  },
  STUN_TCP: {
    name: 'STUN TCP',
    priority: 4,
    category: 'srflx',
    description: 'NAT-traversed TCP via STUN server'
  },

  // TURN relay connections (fallback for restrictive networks)
  TURN_UDP_80: {
    name: 'TURN UDP :80',
    priority: 5,
    category: 'relay',
    port: 80,
    transport: 'udp',
    description: 'Relayed via TURN UDP on port 80 (HTTP port)'
  },
  TURN_UDP_443: {
    name: 'TURN UDP :443',
    priority: 6,
    category: 'relay',
    port: 443,
    transport: 'udp',
    description: 'Relayed via TURN UDP on port 443 (HTTPS port)'
  },
  TURN_TCP_443: {
    name: 'TURN TCP :443',
    priority: 7,
    category: 'relay',
    port: 443,
    transport: 'tcp',
    description: 'Relayed via TURN TCP on port 443 (looks like HTTPS)'
  },
  TURNS_TLS_443: {
    name: 'TURN TLS :443',
    priority: 8,
    category: 'relay',
    port: 443,
    transport: 'tls',
    description: 'Relayed via TURN TLS on port 443 (encrypted, indistinguishable from HTTPS)'
  },
  UNKNOWN: {
    name: 'Unknown',
    priority: 99,
    category: 'unknown',
    description: 'Connection type could not be determined'
  }
};

// ============================================
// OpenRelay TURN Server Configuration
// ============================================

/**
 * OpenRelay TURN Server Credentials
 * Public TURN servers operated by metered.ca
 * Free tier: 20GB/month
 */
const OPENRELAY_USERNAME = 'openrelayproject';
const OPENRELAY_CREDENTIAL = 'openrelayproject';
const OPENRELAY_HOST = 'openrelay.metered.ca';

// ============================================
// Primary ICE Configuration
// ============================================

/**
 * Comprehensive ICE configuration with maximum compatibility
 *
 * Includes:
 * - Multiple STUN servers for redundancy
 * - All OpenRelay TURN servers with different transports/ports
 * - Optimal RTCConfiguration settings
 */
export const ICE_CONFIG = {
  // ICE Servers (STUN + TURN)
  iceServers: [
    // ========================================
    // STUN Servers
    // ========================================
    // Google's public STUN servers - highly reliable
    // Used for discovering public IP addresses (NAT traversal)
    {
      urls: 'stun:stun.l.google.com:19302'
    },
    {
      urls: 'stun:stun1.l.google.com:19302'
    },
    {
      urls: 'stun:stun2.l.google.com:19302'
    },
    {
      urls: 'stun:stun3.l.google.com:19302'
    },

    // OpenRelay STUN server (on port 80 for firewall compatibility)
    {
      urls: `stun:${OPENRELAY_HOST}:80`
    },

    // ========================================
    // TURN Servers - OpenRelay
    // ========================================
    // All transports and ports for maximum fallback coverage

    // TURN UDP on port 80
    // Port 80 is the standard HTTP port, rarely blocked by firewalls
    // Good for corporate networks that allow web browsing
    {
      urls: `turn:${OPENRELAY_HOST}:80`,
      username: OPENRELAY_USERNAME,
      credential: OPENRELAY_CREDENTIAL
    },

    // TURN UDP on port 443
    // Port 443 is the standard HTTPS port, almost never blocked
    // Highest success rate for restrictive networks
    {
      urls: `turn:${OPENRELAY_HOST}:443`,
      username: OPENRELAY_USERNAME,
      credential: OPENRELAY_CREDENTIAL
    },

    // TURN TCP on port 443
    // TCP transport when UDP is blocked entirely
    // Looks like HTTPS traffic to deep packet inspection
    {
      urls: `turn:${OPENRELAY_HOST}:443?transport=tcp`,
      username: OPENRELAY_USERNAME,
      credential: OPENRELAY_CREDENTIAL
    },

    // TURN TLS on port 443 (TURNS protocol)
    // Encrypted transport, completely indistinguishable from HTTPS
    // Works in the most restrictive corporate environments
    // Maximum compatibility but slightly higher latency
    {
      urls: `turns:${OPENRELAY_HOST}:443?transport=tcp`,
      username: OPENRELAY_USERNAME,
      credential: OPENRELAY_CREDENTIAL
    }
  ],

  // ========================================
  // RTCConfiguration Options
  // ========================================

  /**
   * ICE Transport Policy
   * 'all' - Use all connection types (host, srflx, relay)
   * 'relay' - Only use TURN servers (force relay for privacy/testing)
   */
  iceTransportPolicy: 'all',

  /**
   * ICE Candidate Pool Size
   * Pre-gather ICE candidates to speed up connection establishment
   * Higher values = faster connections but more resources
   * Range: 0-10, Default: 0
   * Set to 0 when using trickle: false to avoid duplicate candidates
   */
  iceCandidatePoolSize: 0,

  /**
   * Bundle Policy
   * Controls media multiplexing strategy
   * 'max-bundle' - Bundle all media on single transport (recommended)
   * 'balanced' - Balance between multiplexing and compatibility
   * 'max-compat' - Maximum compatibility, separate transports
   */
  bundlePolicy: 'max-bundle',

  /**
   * RTCP Mux Policy
   * Controls RTP/RTCP multiplexing
   * 'require' - Multiplex RTP and RTCP on same port (recommended)
   * 'negotiate' - Negotiate with peer (fallback)
   */
  rtcpMuxPolicy: 'require'
};

// ============================================
// Helper Functions
// ============================================

/**
 * Detect connection type from ICE candidate information
 * @param {RTCIceCandidate} localCandidate - Local ICE candidate
 * @param {RTCIceCandidate} remoteCandidate - Remote ICE candidate
 * @returns {Object} Connection type object from ConnectionType enum
 */
export function detectConnectionType(localCandidate, remoteCandidate) {
  if (!localCandidate) {
    return ConnectionType.UNKNOWN;
  }

  const type = localCandidate.candidateType || localCandidate.type;
  const protocol = (localCandidate.protocol || '').toLowerCase();
  const port = localCandidate.port;

  // Direct connections (host candidates)
  if (type === 'host') {
    if (protocol === 'udp') {
      return ConnectionType.DIRECT_UDP;
    } else if (protocol === 'tcp') {
      return ConnectionType.DIRECT_TCP;
    }
  }

  // STUN-assisted connections (server reflexive)
  if (type === 'srflx') {
    if (protocol === 'udp') {
      return ConnectionType.STUN_UDP;
    } else if (protocol === 'tcp') {
      return ConnectionType.STUN_TCP;
    }
  }

  // TURN relay connections
  if (type === 'relay') {
    // Determine specific TURN configuration by port and transport
    if (protocol === 'udp') {
      if (port === 80) {
        return ConnectionType.TURN_UDP_80;
      } else if (port === 443) {
        return ConnectionType.TURN_UDP_443;
      }
      // Default UDP relay
      return ConnectionType.TURN_UDP_443;
    } else if (protocol === 'tcp') {
      // TCP on 443 could be either TCP or TLS
      // Check the URL or relatedAddress for TLS indicators
      const relayUrl = localCandidate.url || '';
      if (relayUrl.startsWith('turns:')) {
        return ConnectionType.TURNS_TLS_443;
      }
      return ConnectionType.TURN_TCP_443;
    }
  }

  return ConnectionType.UNKNOWN;
}

/**
 * Get connection type from stats report
 * @param {RTCStatsReport} stats - Stats from getStats()
 * @returns {Object} Connection type information
 */
export function detectConnectionTypeFromStats(stats) {
  let selectedPair = null;
  let localCandidate = null;
  let remoteCandidate = null;

  // Find the active candidate pair
  stats.forEach(report => {
    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
      selectedPair = report;
    }
  });

  if (!selectedPair) {
    return {
      connectionType: ConnectionType.UNKNOWN,
      localCandidate: null,
      remoteCandidate: null
    };
  }

  // Find the local and remote candidates
  stats.forEach(report => {
    if (report.id === selectedPair.localCandidateId) {
      localCandidate = report;
    }
    if (report.id === selectedPair.remoteCandidateId) {
      remoteCandidate = report;
    }
  });

  return {
    connectionType: detectConnectionType(localCandidate, remoteCandidate),
    localCandidate,
    remoteCandidate,
    selectedPair
  };
}

/**
 * Check if connection is direct (not relayed)
 * @param {Object} connectionType - Connection type from ConnectionType enum
 * @returns {boolean} True if direct connection
 */
export function isDirectConnection(connectionType) {
  return connectionType.category === 'host' || connectionType.category === 'srflx';
}

/**
 * Check if connection is relayed through TURN
 * @param {Object} connectionType - Connection type from ConnectionType enum
 * @returns {boolean} True if relayed connection
 */
export function isRelayedConnection(connectionType) {
  return connectionType.category === 'relay';
}

export default ICE_CONFIG;
