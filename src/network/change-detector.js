/**
 * NetworkChangeDetector - Monitors network changes and IP address changes
 *
 * This class monitors network connectivity and detects when the user's IP address
 * changes (e.g., switching from WiFi to cellular, network reconnection, etc.).
 * It uses browser APIs and STUN servers to detect these changes.
 *
 * Browser APIs used:
 * - navigator.connection (Network Information API) - Connection type/quality
 * - navigator.onLine - Online/offline status
 * - window online/offline events - Connectivity state changes
 * - WebRTC/STUN - Public IP address detection
 *
 * Browser Compatibility:
 * - Network Information API: Chrome, Edge, Opera (not Safari/Firefox)
 * - navigator.onLine: All modern browsers
 * - WebRTC: All modern browsers
 *
 * @example
 * const detector = new NetworkChangeDetector(reconnector);
 * detector.initialize();
 *
 * // Later...
 * console.log(detector.getStats());
 * detector.destroy();
 */
export default class NetworkChangeDetector {
  /**
   * Create a NetworkChangeDetector
   * @param {Object} reconnector - MasterReconnectionStrategy instance
   */
  constructor(reconnector) {
    this.reconnector = reconnector;

    // State tracking
    this.lastConnectionType = null;
    this.lastKnownIP = null;

    // Statistics
    this.ipChangeCount = 0;
    this.connectionTypeChangeCount = 0;
    this.onlineCount = 0;
    this.offlineCount = 0;

    // Timestamps
    this.lastIpChangeTime = null;
    this.lastOnlineTime = null;
    this.lastOfflineTime = null;
    this.startTime = Date.now();

    // Intervals and timeouts
    this.ipCheckInterval = null;
    this.changeTimeout = null;

    // Event listener references (for cleanup)
    this.connectionChangeListener = null;
    this.onlineListener = null;
    this.offlineListener = null;

    // Feature detection
    this.hasNetworkInfo = !!navigator.connection;
    this.hasWebRTC = !!(window.RTCPeerConnection || window.webkitRTCPeerConnection);

    console.log('[NetworkDetector] Initialized with features:', {
      networkInfo: this.hasNetworkInfo,
      webRTC: this.hasWebRTC,
      onLine: navigator.onLine
    });
  }

  /**
   * Initialize detector and set up listeners
   * Starts monitoring network changes and performs initial IP check
   */
  initialize() {
    console.log('[NetworkDetector] Starting network change monitoring...');

    // Set up event listeners
    this.setupListeners();

    // Initial connection type
    this.lastConnectionType = this.getConnectionType();
    console.log('[NetworkDetector] Initial connection type:', this.lastConnectionType);

    // Periodic IP check (every 2 minutes)
    // This catches IP changes that don't trigger other events
    if (this.hasWebRTC) {
      this.ipCheckInterval = setInterval(() => {
        this.checkPublicIP();
      }, 120000); // 2 minutes

      // Initial IP check (delayed to avoid startup congestion)
      setTimeout(() => {
        this.checkPublicIP();
      }, 2000);
    } else {
      console.warn('[NetworkDetector] WebRTC not available, IP change detection disabled');
    }

    // Set initial online state
    if (navigator.onLine) {
      this.lastOnlineTime = Date.now();
    } else {
      this.lastOfflineTime = Date.now();
    }
  }

  /**
   * Set up browser API listeners
   * Configures listeners for network changes, online/offline events
   */
  setupListeners() {
    // Network Information API listener (connection type changes)
    if (this.hasNetworkInfo) {
      const connection = navigator.connection;

      this.connectionChangeListener = () => {
        // Debounce rapid changes
        if (this.changeTimeout) {
          clearTimeout(this.changeTimeout);
        }

        this.changeTimeout = setTimeout(() => {
          this.handleNetworkChange();
        }, 1000); // Wait 1 second of stability
      };

      connection.addEventListener('change', this.connectionChangeListener);
      console.log('[NetworkDetector] Listening for connection changes');
    } else {
      console.warn('[NetworkDetector] Network Information API not available');
      console.warn('[NetworkDetector] Falling back to online/offline events only');
    }

    // Online event listener
    this.onlineListener = () => {
      this.handleOnline();
    };
    window.addEventListener('online', this.onlineListener);

    // Offline event listener
    this.offlineListener = () => {
      this.handleOffline();
    };
    window.addEventListener('offline', this.offlineListener);

    console.log('[NetworkDetector] Listening for online/offline events');
  }

  /**
   * Handle network connection change
   * Called when the Network Information API detects a change
   * @private
   */
  async handleNetworkChange() {
    console.log('[NetworkDetector] Network connection changed');

    // Get current connection info
    const connectionType = this.getConnectionType();
    const wasType = this.lastConnectionType;

    // Check if connection type actually changed
    if (connectionType !== wasType) {
      console.log(`[NetworkDetector] Connection type changed: ${wasType} → ${connectionType}`);
      this.lastConnectionType = connectionType;
      this.connectionTypeChangeCount++;

      // Log additional connection details if available
      if (this.hasNetworkInfo) {
        const connection = navigator.connection;
        console.log('[NetworkDetector] Connection details:', {
          effectiveType: connection.effectiveType,
          downlink: connection.downlink ? `${connection.downlink} Mbps` : 'unknown',
          rtt: connection.rtt ? `${connection.rtt} ms` : 'unknown',
          saveData: connection.saveData || false
        });
      }
    }

    // Don't check IP if we're offline
    if (!navigator.onLine) {
      console.log('[NetworkDetector] Skipping IP check (offline)');
      return;
    }

    // Give network time to stabilize before checking IP
    // New connections may not be fully established yet
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if IP actually changed
    // This is the real indicator of a network change
    await this.checkPublicIP();
  }

  /**
   * Get current public IP address using STUN
   *
   * This uses WebRTC's ICE gathering process to discover the public IP address.
   * It creates a temporary RTCPeerConnection and uses STUN servers to get
   * ICE candidates that contain the public IP.
   *
   * Note: This may return the local IP on some networks (NAT, VPN, etc.)
   *
   * @returns {Promise<string|null>} IP address or null if failed
   */
  async getPublicIP() {
    if (!this.hasWebRTC) {
      return null;
    }

    try {
      // Create temporary RTCPeerConnection with Google's public STUN server
      const RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      // Create data channel to trigger ICE gathering
      pc.createDataChannel('');

      // Create offer to start ICE gathering process
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE candidates
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          pc.close();
          resolve(null);
        }, 5000); // 5 second timeout

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            // Extract IP from candidate string
            // Candidate format: "candidate:... typ srflx raddr X.X.X.X rport XXXXX"
            const candidateStr = event.candidate.candidate;

            // Match IPv4 or IPv6 addresses
            const ipv4Regex = /([0-9]{1,3}(\.[0-9]{1,3}){3})/;
            const ipv6Regex = /([a-f0-9:]+:+[a-f0-9]+)/i;

            // Try IPv4 first
            let match = candidateStr.match(ipv4Regex);
            if (!match) {
              // Try IPv6
              match = candidateStr.match(ipv6Regex);
            }

            if (match && match[0]) {
              const ip = match[0];

              // Filter out local/private IPs (we want public IP)
              // Private ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
              if (!ip.startsWith('192.168.') &&
                  !ip.startsWith('10.') &&
                  !ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
                clearTimeout(timeout);
                pc.close();
                resolve(ip);
              }
            }
          }
        };

        // ICE gathering complete
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeout);
            pc.close();
            resolve(null);
          }
        };
      });
    } catch (error) {
      console.error('[NetworkDetector] Failed to get public IP:', error);
      return null;
    }
  }

  /**
   * Periodic check for IP changes
   * Compares current public IP with last known IP and triggers reconnection if changed
   *
   * This is the core IP change detection mechanism. It:
   * 1. Gets the current public IP via STUN
   * 2. Compares with last known IP from localStorage
   * 3. If changed, triggers IP change handling in reconnector
   *
   * @private
   */
  async checkPublicIP() {
    console.log('[NetworkDetector] Checking public IP...');

    // Get current public IP
    const currentIP = await this.getPublicIP();

    if (!currentIP) {
      console.warn('[NetworkDetector] Could not determine public IP');
      return;
    }

    console.log('[NetworkDetector] Current IP:', currentIP);

    // Get last known IP from localStorage
    const lastKnownIP = localStorage.getItem('lastKnownPublicIP');

    if (lastKnownIP && lastKnownIP !== currentIP) {
      // IP changed!
      console.log(`[NetworkDetector] 🔄 IP CHANGED: ${lastKnownIP} → ${currentIP}`);

      // Update stored IP
      localStorage.setItem('lastKnownPublicIP', currentIP);
      this.lastKnownIP = currentIP;

      // Update statistics
      this.ipChangeCount++;
      this.lastIpChangeTime = Date.now();

      // Trigger IP change announcement in reconnector
      // This will announce the new IP to all mesh peers
      if (this.reconnector && typeof this.reconnector.handleIpChange === 'function') {
        console.log('[NetworkDetector] Triggering IP change announcement...');
        try {
          await this.reconnector.handleIpChange();
        } catch (error) {
          console.error('[NetworkDetector] Error handling IP change:', error);
        }
      } else {
        console.warn('[NetworkDetector] No reconnector.handleIpChange() method available');
      }
    } else if (!lastKnownIP) {
      // First time, just store it
      console.log(`[NetworkDetector] Initial IP recorded: ${currentIP}`);
      localStorage.setItem('lastKnownPublicIP', currentIP);
      this.lastKnownIP = currentIP;
    } else {
      // IP unchanged
      console.log(`[NetworkDetector] IP unchanged: ${currentIP}`);
    }
  }

  /**
   * Handle going online
   * Called when browser detects network connectivity is restored
   * @private
   */
  async handleOnline() {
    console.log('[NetworkDetector] 🟢 Back online');

    // Update statistics
    this.onlineCount++;
    this.lastOnlineTime = Date.now();

    // Calculate offline duration
    if (this.lastOfflineTime) {
      const offlineDuration = Date.now() - this.lastOfflineTime;
      const durationSec = (offlineDuration / 1000).toFixed(1);
      console.log(`[NetworkDetector] Was offline for ${durationSec}s (${offlineDuration}ms)`);
    }

    // Log connection info
    const connectionType = this.getConnectionType();
    console.log(`[NetworkDetector] Connection type: ${connectionType}`);

    // Give network time to stabilize
    // The connection might not be fully ready immediately
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check for IP change
    // Going online after being offline often means IP changed
    await this.checkPublicIP();
  }

  /**
   * Handle going offline
   * Called when browser detects network connectivity is lost
   * @private
   */
  handleOffline() {
    console.log('[NetworkDetector] 🔴 Went offline');

    // Update statistics
    this.offlineCount++;
    this.lastOfflineTime = Date.now();

    // Calculate online duration
    if (this.lastOnlineTime) {
      const onlineDuration = Date.now() - this.lastOnlineTime;
      const durationSec = (onlineDuration / 1000).toFixed(1);
      console.log(`[NetworkDetector] Was online for ${durationSec}s (${onlineDuration}ms)`);
    }
  }

  /**
   * Detect connection type change (WiFi ↔ Cellular)
   *
   * Uses the Network Information API to determine connection type.
   * Falls back to 'unknown' if API is not available.
   *
   * Connection types (from spec):
   * - bluetooth, cellular, ethernet, none, wifi, wimax, other, unknown
   *
   * Effective types (signal quality):
   * - slow-2g, 2g, 3g, 4g
   *
   * @returns {string} Connection type or 'unknown'
   */
  getConnectionType() {
    if (!this.hasNetworkInfo) {
      return 'unknown';
    }

    const connection = navigator.connection;

    // Prefer specific connection type if available
    if (connection.type && connection.type !== 'unknown') {
      return connection.type;
    }

    // Fall back to effective type (signal quality)
    if (connection.effectiveType) {
      return connection.effectiveType;
    }

    return 'unknown';
  }

  /**
   * Get network change statistics
   *
   * Returns comprehensive statistics about network changes, connection state,
   * and detector operation.
   *
   * @returns {Object} Network statistics
   */
  getStats() {
    const now = Date.now();

    // Calculate durations
    const totalUptime = now - this.startTime;
    const currentOnlineDuration = this.lastOnlineTime ? now - this.lastOnlineTime : 0;
    const currentOfflineDuration = this.lastOfflineTime ? now - this.lastOfflineTime : 0;

    // Get current connection info
    const connectionInfo = {};
    if (this.hasNetworkInfo && navigator.connection) {
      const conn = navigator.connection;
      connectionInfo.effectiveType = conn.effectiveType;
      connectionInfo.type = conn.type;
      connectionInfo.downlink = conn.downlink;
      connectionInfo.rtt = conn.rtt;
      connectionInfo.saveData = conn.saveData;
    }

    return {
      // Current state
      isOnline: navigator.onLine,
      currentConnectionType: this.getConnectionType(),
      lastKnownIP: localStorage.getItem('lastKnownPublicIP'),

      // Connection details
      connectionInfo,

      // Event counters
      ipChangeCount: this.ipChangeCount,
      connectionTypeChangeCount: this.connectionTypeChangeCount,
      onlineCount: this.onlineCount,
      offlineCount: this.offlineCount,

      // Timestamps
      lastIpChangeTime: this.lastIpChangeTime,
      lastOnlineTime: this.lastOnlineTime,
      lastOfflineTime: this.lastOfflineTime,
      startTime: this.startTime,

      // Durations
      totalUptime,
      currentOnlineDuration: navigator.onLine ? currentOnlineDuration : 0,
      currentOfflineDuration: !navigator.onLine ? currentOfflineDuration : 0,

      // Feature availability
      features: {
        networkInfo: this.hasNetworkInfo,
        webRTC: this.hasWebRTC,
        onlineAPI: true // Always available in modern browsers
      }
    };
  }

  /**
   * Get a human-readable status summary
   *
   * @returns {string} Status summary
   */
  getStatusSummary() {
    const stats = this.getStats();
    const lines = [];

    lines.push(`Network Status: ${stats.isOnline ? '🟢 ONLINE' : '🔴 OFFLINE'}`);
    lines.push(`Connection Type: ${stats.currentConnectionType}`);

    if (stats.lastKnownIP) {
      lines.push(`Public IP: ${stats.lastKnownIP}`);
    }

    if (stats.ipChangeCount > 0) {
      lines.push(`IP Changes: ${stats.ipChangeCount}`);
    }

    if (stats.connectionTypeChangeCount > 0) {
      lines.push(`Connection Changes: ${stats.connectionTypeChangeCount}`);
    }

    const uptimeSec = (stats.totalUptime / 1000).toFixed(0);
    lines.push(`Uptime: ${uptimeSec}s`);

    return lines.join('\n');
  }

  /**
   * Stop detector and cleanup
   * Removes all event listeners and clears intervals
   */
  destroy() {
    console.log('[NetworkDetector] Cleaning up...');

    // Clear periodic IP check interval
    if (this.ipCheckInterval) {
      clearInterval(this.ipCheckInterval);
      this.ipCheckInterval = null;
    }

    // Clear pending timeout
    if (this.changeTimeout) {
      clearTimeout(this.changeTimeout);
      this.changeTimeout = null;
    }

    // Remove Network Information API listener
    if (this.connectionChangeListener && this.hasNetworkInfo) {
      navigator.connection.removeEventListener('change', this.connectionChangeListener);
      this.connectionChangeListener = null;
    }

    // Remove online/offline listeners
    if (this.onlineListener) {
      window.removeEventListener('online', this.onlineListener);
      this.onlineListener = null;
    }

    if (this.offlineListener) {
      window.removeEventListener('offline', this.offlineListener);
      this.offlineListener = null;
    }

    console.log('[NetworkDetector] Cleanup complete');
  }
}
