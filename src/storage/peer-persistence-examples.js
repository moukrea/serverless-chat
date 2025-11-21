/**
 * Comprehensive examples for peer-persistence usage
 *
 * This file demonstrates common use cases and integration patterns
 * for the peer persistence system in a P2P mesh chat application.
 */

import peerPersistence, { createPeerData, updateQualityMetrics } from './peer-persistence.js';

// =============================================================================
// EXAMPLE 1: Storing a New Peer After Connection
// =============================================================================

/**
 * Store peer information after successful connection
 */
async function onPeerConnected(peerInfo) {
  console.log('[Example] Storing new peer:', peerInfo.peerId);

  // Create peer data with connection information
  const peerData = createPeerData({
    peerId: peerInfo.peerId,
    userId: peerInfo.userId,
    displayName: peerInfo.displayName || 'Anonymous',
    publicKey: JSON.stringify(peerInfo.publicKey), // Store as JSON string
    sharedSecret: peerInfo.sharedSecret, // Will be encrypted
    lastKnownIP: peerInfo.remoteAddress || null,
    iceServers: peerInfo.iceServers || [],
    cachedCandidates: peerInfo.iceCandidates || [],
    connectionQuality: {
      latency: peerInfo.initialLatency || null,
      connectionType: peerInfo.connectionType || null,
      successRate: 1.0, // First connection
      totalConnections: 1,
      successfulConnections: 1,
    },
    metadata: {
      userAgent: navigator.userAgent,
      protocol: peerInfo.protocol || 'mesh-v1',
    },
  });

  // Store the peer
  const success = await peerPersistence.storePeer(peerData);

  if (success) {
    console.log('[Example] Peer stored successfully');
  } else {
    console.error('[Example] Failed to store peer');
  }

  return success;
}

// =============================================================================
// EXAMPLE 2: Updating Connection Quality Metrics
// =============================================================================

/**
 * Update peer quality metrics during active connection
 */
async function onLatencyMeasured(peerId, latency, connectionType) {
  console.log(`[Example] Updating quality for ${peerId}: ${latency}ms`);

  // Get current peer data
  const peer = await peerPersistence.getPeer(peerId);
  if (!peer) {
    console.warn('[Example] Peer not found');
    return;
  }

  // Update quality metrics
  const updatedQuality = updateQualityMetrics(peer.connectionQuality, {
    latency,
    connectionType,
    success: true,
  });

  // Store updated quality
  await peerPersistence.updateConnectionQuality(peerId, updatedQuality);

  // Also update last seen
  await peerPersistence.updateLastSeen(peerId);
}

/**
 * Update quality after connection closes
 */
async function onConnectionClosed(peerId, uptime) {
  const peer = await peerPersistence.getPeer(peerId);
  if (!peer) return;

  const updatedQuality = updateQualityMetrics(peer.connectionQuality, {
    uptime, // Connection duration in seconds
    success: true,
  });

  await peerPersistence.updateConnectionQuality(peerId, updatedQuality);
}

// =============================================================================
// EXAMPLE 3: Automatic Reconnection on Page Refresh
// =============================================================================

/**
 * Reconnect to peers after page refresh
 */
async function reconnectAfterPageRefresh() {
  console.log('[Example] Attempting automatic reconnection after page refresh');

  // Get best reconnection candidates
  const candidates = await peerPersistence.getReconnectionCandidates({
    limit: 5, // Try top 5 peers
    maxAge: 24 * 60 * 60 * 1000, // Last seen within 24 hours
  });

  console.log(`[Example] Found ${candidates.length} reconnection candidates`);

  for (const candidate of candidates) {
    console.log(
      `[Example] Candidate: ${candidate.peer.peerId.substring(0, 8)} ` +
      `(score: ${candidate.score}, reason: ${candidate.reason})`
    );

    // Attempt reconnection
    const success = await attemptReconnection(candidate.peer);

    if (success) {
      console.log(`[Example] Successfully reconnected to ${candidate.peer.peerId.substring(0, 8)}`);

      // Update quality metrics
      await peerPersistence.updateConnectionQuality(candidate.peer.peerId, {
        lastMeasured: Date.now(),
      });
    } else {
      console.warn(`[Example] Failed to reconnect to ${candidate.peer.peerId.substring(0, 8)}`);

      // Increment failed attempts
      await peerPersistence.incrementReconnectionAttempts(candidate.peer.peerId);
    }
  }
}

/**
 * Simulate reconnection attempt
 */
async function attemptReconnection(peer) {
  // This would integrate with your actual P2P connection logic
  console.log(`[Example] Attempting to reconnect to ${peer.peerId.substring(0, 8)}`);

  try {
    // Use stored ICE candidates and servers
    // const connection = await createPeerConnection({
    //   peerId: peer.peerId,
    //   iceServers: peer.iceServers,
    //   cachedCandidates: peer.cachedCandidates,
    // });

    // For demo, simulate 70% success rate
    const success = Math.random() > 0.3;

    return success;
  } catch (error) {
    console.error('[Example] Reconnection error:', error);
    return false;
  }
}

// =============================================================================
// EXAMPLE 4: Handling IP Address Changes
// =============================================================================

/**
 * Handle peer announcing IP address change
 */
async function onPeerIPChanged(peerId, newIP, newCandidates) {
  console.log(`[Example] Peer ${peerId.substring(0, 8)} changed IP to ${newIP}`);

  const peer = await peerPersistence.getPeer(peerId);
  if (!peer) {
    console.warn('[Example] Unknown peer, cannot update IP');
    return;
  }

  // Update IP and candidates
  peer.lastKnownIP = newIP;
  peer.cachedCandidates = newCandidates;
  peer.lastSeen = Date.now();

  await peerPersistence.storePeer(peer);

  // Attempt to reconnect with new candidates
  console.log('[Example] Attempting reconnection with new IP...');
  const success = await attemptReconnection(peer);

  if (success) {
    console.log('[Example] Successfully reconnected after IP change');
  } else {
    console.warn('[Example] Failed to reconnect after IP change');
    await peerPersistence.incrementReconnectionAttempts(peerId);
  }
}

// =============================================================================
// EXAMPLE 5: Query Patterns
// =============================================================================

/**
 * Get recently active peers
 */
async function getRecentlyActivePeers() {
  const peers = await peerPersistence.queryPeers({
    sortBy: 'lastSeen',
    order: 'desc',
    limit: 10,
    maxAge: 7 * 24 * 60 * 60 * 1000, // Last 7 days
  });

  console.log(`[Example] Found ${peers.length} recently active peers:`);
  peers.forEach(peer => {
    const hoursAgo = Math.floor((Date.now() - peer.lastSeen) / 1000 / 60 / 60);
    console.log(
      `  - ${peer.displayName} (${peer.peerId.substring(0, 8)}): ` +
      `${hoursAgo} hours ago, quality: ${peer._qualityScore}`
    );
  });

  return peers;
}

/**
 * Get high-quality peers for routing
 */
async function getHighQualityPeers() {
  const peers = await peerPersistence.queryPeers({
    sortBy: 'quality',
    order: 'desc',
    limit: 5,
    minQuality: 60, // Quality score >= 60
  });

  console.log(`[Example] Found ${peers.length} high-quality peers for routing`);
  return peers;
}

/**
 * Get all peers with valid shared secrets
 */
async function getAuthenticatedPeers() {
  const allPeers = await peerPersistence.queryPeers({
    excludeBlacklisted: true,
  });

  const authenticated = allPeers.filter(peer => peer.sharedSecret !== null);

  console.log(`[Example] Found ${authenticated.length} authenticated peers`);
  return authenticated;
}

// =============================================================================
// EXAMPLE 6: Cleanup and Maintenance
// =============================================================================

/**
 * Run periodic maintenance
 */
async function runPeriodicMaintenance() {
  console.log('[Example] Running periodic maintenance');

  // Check if cleanup is needed
  const needsCleanup = await peerPersistence.needsCleanup();

  if (needsCleanup) {
    console.log('[Example] Cleanup needed, running cleanup...');

    // Clean stale peers
    const removedStale = await peerPersistence.cleanupStalePeers();
    console.log(`[Example] Removed ${removedStale} stale peers`);

    // Clear expired blacklists
    const clearedBlacklists = await peerPersistence.clearExpiredBlacklists();
    console.log(`[Example] Cleared ${clearedBlacklists} expired blacklists`);
  }

  // Show storage stats
  const stats = await peerPersistence.getStorageStats();
  console.log('[Example] Storage stats:', {
    peers: stats.peerCount,
    size: stats.estimatedSizeMB + ' MB',
    utilization: stats.utilizationPercent + '%',
  });
}

/**
 * Schedule periodic cleanup
 */
function schedulePeriodicCleanup() {
  // Run cleanup every 6 hours
  setInterval(runPeriodicMaintenance, 6 * 60 * 60 * 1000);

  // Run immediately on startup
  runPeriodicMaintenance();
}

// =============================================================================
// EXAMPLE 7: Storage Management
// =============================================================================

/**
 * Monitor storage usage
 */
async function monitorStorage() {
  const stats = await peerPersistence.getStorageStats();

  console.log('[Example] Storage monitoring:', {
    peerCount: stats.peerCount,
    maxPeers: stats.maxPeers,
    sizeBytes: stats.estimatedSizeBytes,
    sizeMB: stats.estimatedSizeMB,
    utilization: stats.utilizationPercent + '%',
  });

  // Alert if approaching limits
  if (parseFloat(stats.utilizationPercent) > 80) {
    console.warn('[Example] Storage usage high, consider cleanup');
  }

  return stats;
}

/**
 * Export data for backup
 */
async function backupPeerData() {
  console.log('[Example] Creating backup...');

  const exportData = await peerPersistence.exportData();

  console.log(`[Example] Exported ${exportData.peers.length} peers`);

  // In a real application, you might:
  // 1. Save to a file
  // 2. Upload to cloud storage
  // 3. Store in IndexedDB for larger capacity

  // For demo, save to a downloadable JSON file
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);

  // Create download link
  const a = document.createElement('a');
  a.href = url;
  a.download = `peer-backup-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);

  console.log('[Example] Backup download initiated');
}

/**
 * Restore from backup
 */
async function restorePeerData(backupData) {
  console.log('[Example] Restoring from backup...');

  const imported = await peerPersistence.importData(backupData);

  console.log(`[Example] Restored ${imported} peers`);

  return imported;
}

// =============================================================================
// EXAMPLE 8: Integration with Application Lifecycle
// =============================================================================

/**
 * Initialize peer persistence on app startup
 */
async function initializeApp() {
  console.log('[Example] Initializing application...');

  // Initialize peer persistence
  await peerPersistence.initialize();

  // Schedule periodic cleanup
  schedulePeriodicCleanup();

  // Attempt automatic reconnection
  await reconnectAfterPageRefresh();

  console.log('[Example] Application initialized');
}

/**
 * Clean up on app shutdown/logout
 */
async function shutdownApp(clearData = false) {
  console.log('[Example] Shutting down application...');

  if (clearData) {
    // Clear all data on explicit logout
    await peerPersistence.clearAll();
    console.log('[Example] All peer data cleared');
  } else {
    // Just update metadata for clean restart
    await peerPersistence.updateMetadata({
      lastShutdown: Date.now(),
    });
  }

  console.log('[Example] Application shutdown complete');
}

// =============================================================================
// EXAMPLE 9: Error Handling and Recovery
// =============================================================================

/**
 * Handle storage quota exceeded
 */
async function handleStorageQuotaExceeded() {
  console.warn('[Example] Storage quota exceeded, performing emergency cleanup');

  // Remove bottom 20% of peers by quality
  const allPeers = await peerPersistence.queryPeers({
    sortBy: 'quality',
    order: 'asc', // Worst quality first
  });

  const toRemove = Math.ceil(allPeers.length * 0.2);

  for (let i = 0; i < toRemove; i++) {
    await peerPersistence.removePeer(allPeers[i].peerId);
  }

  console.log(`[Example] Emergency cleanup: removed ${toRemove} low-quality peers`);
}

/**
 * Recover from corrupted data
 */
async function recoverFromCorruption() {
  console.error('[Example] Detected corrupted peer data, attempting recovery');

  try {
    // Get all peer IDs
    const peerIds = await peerPersistence.getAllPeerIds();

    // Validate each peer
    let corrupted = 0;
    for (const peerId of peerIds) {
      const peer = await peerPersistence.getPeer(peerId);

      if (!peer || !peer.peerId || !peer.displayName) {
        // Invalid peer, remove it
        await peerPersistence.removePeer(peerId);
        corrupted++;
      }
    }

    console.log(`[Example] Recovery complete: removed ${corrupted} corrupted entries`);
  } catch (error) {
    console.error('[Example] Recovery failed, clearing all data:', error);
    await peerPersistence.clearAll();
  }
}

// =============================================================================
// EXAMPLE 10: Advanced Scoring and Prioritization
// =============================================================================

/**
 * Custom reconnection logic with business rules
 */
async function getSmartReconnectionTargets() {
  console.log('[Example] Finding smart reconnection targets...');

  // Get all candidates
  const candidates = await peerPersistence.getReconnectionCandidates({
    limit: 20, // Get more candidates for filtering
  });

  // Apply business logic
  const targets = candidates
    .filter(c => {
      // Skip peers not seen in last 24 hours
      const hoursSinceLastSeen = (Date.now() - c.peer.lastSeen) / 1000 / 60 / 60;
      if (hoursSinceLastSeen > 24) return false;

      // Skip peers with too many failed attempts
      if (c.peer.reconnectionAttempts > 3) return false;

      // Skip low-quality connections
      if (c.score < 50) return false;

      return true;
    })
    .slice(0, 5); // Take top 5

  console.log(`[Example] Selected ${targets.length} smart reconnection targets`);

  // Log details
  targets.forEach((target, i) => {
    console.log(`[Example] Target ${i + 1}:`, {
      peerId: target.peer.peerId.substring(0, 8),
      displayName: target.peer.displayName,
      score: target.score,
      reason: target.reason,
      latency: target.peer.connectionQuality.latency,
      successRate: (target.peer.connectionQuality.successRate * 100).toFixed(1) + '%',
    });
  });

  return targets;
}

// =============================================================================
// EXPORT EXAMPLES
// =============================================================================

export {
  // Lifecycle
  initializeApp,
  shutdownApp,

  // Connection management
  onPeerConnected,
  onLatencyMeasured,
  onConnectionClosed,
  onPeerIPChanged,

  // Reconnection
  reconnectAfterPageRefresh,
  attemptReconnection,
  getSmartReconnectionTargets,

  // Queries
  getRecentlyActivePeers,
  getHighQualityPeers,
  getAuthenticatedPeers,

  // Maintenance
  runPeriodicMaintenance,
  schedulePeriodicCleanup,
  monitorStorage,

  // Backup/Restore
  backupPeerData,
  restorePeerData,

  // Error handling
  handleStorageQuotaExceeded,
  recoverFromCorruption,
};

// =============================================================================
// USAGE IN MAIN APPLICATION
// =============================================================================

/*
// In your main application file:

import { initializeApp, onPeerConnected, reconnectAfterPageRefresh } from './storage/peer-persistence-examples.js';

// On app startup
window.addEventListener('load', async () => {
  await initializeApp();
});

// On peer connection
peerManager.onConnection(async (peerId, peerInfo) => {
  await onPeerConnected(peerInfo);
});

// On visibility change (mobile browsers)
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden) {
    await reconnectAfterPageRefresh();
  }
});
*/
