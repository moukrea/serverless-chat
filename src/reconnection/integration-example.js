/**
 * Integration Example: MeshAnnouncementManager
 *
 * This example shows how to integrate the announcement manager
 * into your P2P mesh chat application.
 */

import MeshAnnouncementManager from './mesh-announcements.js';
import identity from '../core/identity.js';
import MessageRouter from '../mesh-router.js';
import ReconnectionAuth from '../reconnection-auth.js';
import peerPersistence from '../storage/peer-persistence.js';

// =============================================================================
// STEP 1: Initialize Components
// =============================================================================

// Initialize identity first
await identity.initialize();

// Initialize reconnection auth
const reconnectionAuth = new ReconnectionAuth(identity);
await reconnectionAuth.initialize();

// Create router
const router = new MessageRouter(identity);

// Create mesh network (your existing code)
const meshNetwork = new MeshNetwork(identity);

// Set peer manager for router
router.setPeerManager(meshNetwork);

// =============================================================================
// STEP 2: Create Announcement Manager
// =============================================================================

const announcementManager = new MeshAnnouncementManager(
  identity,
  router,
  meshNetwork,
  reconnectionAuth,
  peerPersistence
);

// Initialize (registers message handlers)
announcementManager.initialize();

console.log('[App] Announcement manager initialized');

// =============================================================================
// STEP 3: Announce Presence on First Connection
// =============================================================================

// Track if we've announced yet
let hasAnnounced = false;

// Hook into peer connection events
const originalOnPeerConnect = meshNetwork.onPeerConnect;
meshNetwork.onPeerConnect = async (peerId, displayName) => {
  // Call original handler
  if (originalOnPeerConnect) {
    originalOnPeerConnect(peerId, displayName);
  }

  // Announce presence on first connection
  if (!hasAnnounced) {
    hasAnnounced = true;

    console.log('[App] First peer connected, announcing presence');

    // Determine reason based on context
    const storedPeers = await peerPersistence.getAllPeerIds();
    const reason = storedPeers.length > 0 ? 'rejoin' : 'cold_start_recovery';

    // Announce
    await announcementManager.announcePresence(reason);

    // Start periodic heartbeat
    announcementManager.startPeriodicAnnouncements(120000); // Every 2 minutes
  }
};

// =============================================================================
// STEP 4: Handle IP Changes
// =============================================================================

// Monitor network status
window.addEventListener('online', async () => {
  console.log('[App] Network back online');

  // Announce IP change
  await announcementManager.announceIpChange();
});

// Monitor connection type changes (if available)
if (navigator.connection) {
  navigator.connection.addEventListener('change', async () => {
    const type = navigator.connection.effectiveType;
    console.log('[App] Connection type changed:', type);

    // Announce IP change (may have new IP)
    await announcementManager.announceIpChange();
  });
}

// =============================================================================
// STEP 5: Cold Start Recovery
// =============================================================================

/**
 * Attempt to recover connections on cold start
 */
async function attemptColdStartRecovery() {
  // Check if we have stored peers
  const candidates = await peerPersistence.getReconnectionCandidates({
    limit: 5,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  if (candidates.length === 0) {
    console.log('[App] No reconnection candidates found');
    return false;
  }

  console.log(`[App] Found ${candidates.length} reconnection candidates`);

  // If we have no connections, announce presence to trigger reconnection
  const connectedCount = meshNetwork.getConnectedPeerCount();

  if (connectedCount === 0) {
    console.log('[App] No connections, announcing for cold start recovery');
    await announcementManager.announcePresence('cold_start_recovery');
    return true;
  }

  return false;
}

// Try cold start recovery after initialization
setTimeout(async () => {
  const attempted = await attemptColdStartRecovery();

  if (!attempted) {
    console.log('[App] Skipping cold start recovery (already connected or no candidates)');
  }
}, 5000); // Wait 5 seconds after page load

// =============================================================================
// STEP 6: Implement Reconnection Handler in MeshNetwork
// =============================================================================

/**
 * Add reconnection method to mesh network
 * (This should ideally be in mesh.js)
 */
meshNetwork.reconnectToPeer = async function(peerId, displayName, connectionHint) {
  console.log(`[Mesh] Reconnecting to ${displayName} (${peerId.substring(0, 8)})`);

  try {
    // Get peer data from persistence
    const peerData = await peerPersistence.getPeer(peerId);

    if (!peerData) {
      console.warn(`[Mesh] No stored data for peer ${peerId.substring(0, 8)}`);
      return false;
    }

    // Check if we have cached ICE candidates
    const hasCachedCandidates = peerData.cachedCandidates &&
                                 peerData.cachedCandidates.length > 0;

    console.log(`[Mesh] Peer data found, cached candidates: ${hasCachedCandidates}`);

    // Option 1: Try direct reconnection if we have cached data
    if (hasCachedCandidates) {
      // Attempt direct connection using cached candidates
      // (Implementation depends on your WebRTC setup)
      console.log('[Mesh] Attempting direct reconnection with cached candidates');
    }

    // Option 2: Request introduction from relay peer
    if (connectionHint && connectionHint.preferredRelay) {
      const relayPeerId = connectionHint.preferredRelay;
      const relayPeer = this.peers.get(relayPeerId);

      if (relayPeer && relayPeer.status === 'connected') {
        console.log(`[Mesh] Requesting introduction via relay ${relayPeerId.substring(0, 8)}`);

        // Request introduction (use existing introduction manager)
        // this.introManager.requestIntroduction(relayPeerId, peerId);
      }
    }

    // Option 3: Wait for them to initiate (if tie-breaking says so)
    // This is already handled by shouldInitiate() check

    return true;

  } catch (error) {
    console.error(`[Mesh] Failed to reconnect to ${displayName}:`, error);
    return false;
  }
};

// =============================================================================
// STEP 7: UI Integration
// =============================================================================

/**
 * Show announcement status in UI
 */
function updateAnnouncementStatus() {
  const stats = announcementManager.getStats();

  const statusEl = document.getElementById('announcement-status');
  if (statusEl) {
    statusEl.textContent = `
      Sent: ${stats.announcementsSent}
      Received: ${stats.announcementsReceived}
      Duplicates: ${stats.duplicatesIgnored}
      Reconnections: ${stats.reconnectionsInitiated}
    `;
  }
}

// Update every 10 seconds
setInterval(updateAnnouncementStatus, 10000);

// =============================================================================
// STEP 8: Manual Controls
// =============================================================================

/**
 * Manual announcement trigger
 */
window.announcePresence = async function() {
  console.log('[App] Manual presence announcement');
  await announcementManager.announcePresence('periodic');
  alert('Presence announced to mesh network');
};

/**
 * Manual IP change announcement
 */
window.announceIpChange = async function() {
  console.log('[App] Manual IP change announcement');
  await announcementManager.announceIpChange();
  alert('IP change announced to mesh network');
};

/**
 * Show stats
 */
window.showAnnouncementStats = function() {
  const stats = announcementManager.getStats();
  console.table(stats);
  alert(JSON.stringify(stats, null, 2));
};

// =============================================================================
// STEP 9: Cleanup on Page Unload
// =============================================================================

window.addEventListener('beforeunload', () => {
  console.log('[App] Cleaning up announcement manager');
  announcementManager.destroy();
});

// =============================================================================
// STEP 10: Error Handling
// =============================================================================

/**
 * Global error handler for announcement failures
 */
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && event.reason.message) {
    if (event.reason.message.includes('announcement')) {
      console.error('[App] Announcement error:', event.reason);
      // Non-fatal - log and continue
      event.preventDefault();
    }
  }
});

// =============================================================================
// EXPORTS
// =============================================================================

export {
  announcementManager,
  attemptColdStartRecovery,
};

console.log('[App] Announcement system fully integrated');
