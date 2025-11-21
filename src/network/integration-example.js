/**
 * Network Change Detector Integration Example
 *
 * This example demonstrates how to integrate the NetworkChangeDetector
 * with the mesh network and announcement system.
 *
 * The detector monitors network changes and automatically triggers
 * IP change announcements to the mesh when the user's IP changes.
 *
 * @example
 * // In your main application initialization:
 * import NetworkChangeDetector from './network/change-detector.js';
 * import MeshAnnouncementManager from './reconnection/mesh-announcements.js';
 *
 * // Initialize network detector
 * const networkDetector = new NetworkChangeDetector(announcementManager);
 * networkDetector.initialize();
 */

// =============================================================================
// INTEGRATION ADAPTER
// =============================================================================

/**
 * ReconnectorAdapter - Adapts MeshAnnouncementManager for NetworkChangeDetector
 *
 * The NetworkChangeDetector expects a reconnector with a handleIpChange() method.
 * This adapter wraps MeshAnnouncementManager to provide the expected interface.
 */
class ReconnectorAdapter {
  /**
   * Create adapter
   * @param {MeshAnnouncementManager} announcementManager - Mesh announcement manager
   */
  constructor(announcementManager) {
    this.announcementManager = announcementManager;
  }

  /**
   * Handle IP address change
   * Called by NetworkChangeDetector when IP changes
   *
   * @returns {Promise<void>}
   */
  async handleIpChange() {
    console.log('[ReconnectorAdapter] IP change detected, announcing to mesh...');

    try {
      // Announce IP change to the mesh network
      const success = await this.announcementManager.announceIpChange();

      if (success) {
        console.log('[ReconnectorAdapter] ✅ IP change announced successfully');
      } else {
        console.warn('[ReconnectorAdapter] ⚠️ Failed to announce IP change');
      }
    } catch (error) {
      console.error('[ReconnectorAdapter] Error announcing IP change:', error);
      throw error;
    }
  }

  /**
   * Get announcement statistics
   * @returns {Object}
   */
  getStats() {
    return this.announcementManager.getStats();
  }
}

// =============================================================================
// COMPLETE INTEGRATION EXAMPLE
// =============================================================================

/**
 * Example: Complete network monitoring setup
 *
 * This shows how to set up the complete network monitoring and
 * reconnection system for your mesh chat application.
 */
async function setupNetworkMonitoring(app) {
  console.log('=== Setting up network monitoring ===');

  // Assuming you have these instances from your main application:
  const {
    identity,
    router,
    peerManager,
    reconnectionAuth,
    peerPersistence
  } = app;

  // 1. Create MeshAnnouncementManager
  const announcementManager = new MeshAnnouncementManager(
    identity,
    router,
    peerManager,
    reconnectionAuth,
    peerPersistence
  );

  // Initialize and register message handlers
  announcementManager.initialize();

  // Start periodic heartbeat announcements
  announcementManager.startPeriodicAnnouncements();

  // 2. Create adapter for NetworkChangeDetector
  const reconnectorAdapter = new ReconnectorAdapter(announcementManager);

  // 3. Create and initialize NetworkChangeDetector
  const networkDetector = new NetworkChangeDetector(reconnectorAdapter);
  networkDetector.initialize();

  // 4. Set up cleanup on app shutdown
  window.addEventListener('beforeunload', () => {
    console.log('App shutting down, cleaning up network monitoring...');
    networkDetector.destroy();
    announcementManager.destroy();
  });

  // 5. Optional: Set up status monitoring
  setInterval(() => {
    const networkStats = networkDetector.getStats();
    const announcementStats = announcementManager.getStats();

    console.log('Network Status:', {
      online: networkStats.isOnline,
      connectionType: networkStats.currentConnectionType,
      ipChanges: networkStats.ipChangeCount,
      announcements: announcementStats.announcementsSent
    });
  }, 60000); // Every minute

  // 6. Optional: Expose for debugging
  if (typeof window !== 'undefined') {
    window.networkDetector = networkDetector;
    window.announcementManager = announcementManager;

    // Debug command
    window.checkNetworkStatus = () => {
      console.log('\n=== Network Status Report ===');
      console.log(networkDetector.getStatusSummary());
      console.log('\nDetailed Stats:', networkDetector.getStats());
      console.log('\nAnnouncement Stats:', announcementManager.getStats());
    };
  }

  console.log('✅ Network monitoring initialized successfully');

  return {
    networkDetector,
    announcementManager,
    reconnectorAdapter
  };
}

// =============================================================================
// ALTERNATIVE: DIRECT INTEGRATION (WITHOUT ADAPTER)
// =============================================================================

/**
 * Alternative approach: Extend NetworkChangeDetector to use MeshAnnouncementManager directly
 */
class MeshNetworkChangeDetector extends NetworkChangeDetector {
  /**
   * @param {MeshAnnouncementManager} announcementManager
   */
  constructor(announcementManager) {
    // Create a simple adapter object
    const adapter = {
      handleIpChange: async () => {
        return await announcementManager.announceIpChange();
      }
    };

    super(adapter);
    this.announcementManager = announcementManager;
  }

  /**
   * Get combined statistics
   */
  getCombinedStats() {
    return {
      network: this.getStats(),
      announcements: this.announcementManager.getStats()
    };
  }
}

// Usage:
// const detector = new MeshNetworkChangeDetector(announcementManager);
// detector.initialize();

// =============================================================================
// MANUAL IP CHANGE TESTING
// =============================================================================

/**
 * Test IP change detection manually
 *
 * Useful for testing the system without waiting for real network changes.
 */
async function testIpChangeDetection(networkDetector) {
  console.log('\n=== Testing IP Change Detection ===');

  // Get current IP
  const currentIP = await networkDetector.getPublicIP();
  console.log('Current IP:', currentIP);

  // Simulate IP change by modifying localStorage
  const fakeOldIP = '203.0.113.42'; // Documentation IP range
  localStorage.setItem('lastKnownPublicIP', fakeOldIP);

  console.log(`Set fake old IP: ${fakeOldIP}`);
  console.log('Waiting 2 seconds...');

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Trigger IP check
  console.log('Triggering IP check...');
  await networkDetector.checkPublicIP();

  console.log('IP change detection test complete');
}

// =============================================================================
// EVENT LISTENERS FOR DEBUGGING
// =============================================================================

/**
 * Add detailed logging for network events (debugging only)
 */
function enableNetworkDebugLogging() {
  // Log all online/offline transitions
  let wasOnline = navigator.onLine;

  setInterval(() => {
    const isOnline = navigator.onLine;

    if (isOnline !== wasOnline) {
      console.log(`[NetworkDebug] State changed: ${wasOnline ? 'ONLINE' : 'OFFLINE'} → ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
      wasOnline = isOnline;
    }
  }, 1000);

  // Log Network Information API changes
  if (navigator.connection) {
    const connection = navigator.connection;
    let lastType = connection.effectiveType;

    connection.addEventListener('change', () => {
      const newType = connection.effectiveType;
      console.log(`[NetworkDebug] Connection type: ${lastType} → ${newType}`);
      console.log(`[NetworkDebug] Details:`, {
        effectiveType: connection.effectiveType,
        type: connection.type,
        downlink: connection.downlink,
        rtt: connection.rtt,
        saveData: connection.saveData
      });
      lastType = newType;
    });
  }

  console.log('[NetworkDebug] Debug logging enabled');
}

// =============================================================================
// EXPORTS
// =============================================================================

export default setupNetworkMonitoring;
export {
  ReconnectorAdapter,
  MeshNetworkChangeDetector,
  testIpChangeDetection,
  enableNetworkDebugLogging
};
