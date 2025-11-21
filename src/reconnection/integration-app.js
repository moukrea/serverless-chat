/**
 * Integration code for app.js
 *
 * This file shows how to integrate automatic reconnection into your main application.
 * Add these sections to your existing app.js file.
 */

// ============================================
// 1. AUTOMATIC RECONNECTION ON PAGE LOAD
// ============================================

// Add this after mesh network initialization (around line 1030)

// Initialize mesh network
const mesh = new MeshNetwork(identity);

// ... existing mesh setup code ...

// NEW: Automatic reconnection on page load
async function initializeReconnection() {
  console.log('[App] Initializing automatic reconnection...');

  try {
    // Check if reconnection is enabled
    if (!mesh.reconnectionEnabled) {
      console.warn('[App] Reconnection system not available');
      return;
    }

    // Small delay to let network stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Attempt reconnection
    const result = await mesh.reconnectToMesh();

    if (result.method === 'fallback_required') {
      // All automatic reconnection failed, show manual pairing UI
      console.log('[App] Automatic reconnection failed, showing pairing UI');
      addMessage('No saved connections found. Click "New Connection" to connect.', 'system');
    } else if (result.peersConnected > 0) {
      // Successfully reconnected
      console.log(`[App] Reconnected to ${result.peersConnected} peer(s)`);
      addMessage(`Reconnected to ${result.peersConnected} peer(s) automatically! 🎉`, 'system');

      // Enable UI
      $('messageInput').disabled = false;
      $('btnSend').disabled = false;
    } else {
      // No peers to reconnect to
      console.log('[App] No peers available for reconnection');
      addMessage('No saved connections. Click "New Connection" to connect.', 'system');
    }
  } catch (error) {
    console.error('[App] Reconnection failed:', error);
    addMessage('Reconnection error. Click "New Connection" to connect manually.', 'system');
  }
}

// Call after initialization
window.addEventListener('DOMContentLoaded', () => {
  // Existing initialization code...

  // NEW: Start automatic reconnection
  initializeReconnection();
});

// ============================================
// 2. SHOW RECONNECTION STATUS IN UI
// ============================================

// Add a reconnection status indicator
function showReconnectionStatus(message, type = 'info') {
  const statusDiv = document.createElement('div');
  statusDiv.className = `reconnection-status reconnection-status-${type}`;
  statusDiv.textContent = message;
  statusDiv.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#43b581' : type === 'error' ? '#f04747' : '#5865f2'};
    color: white;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 1000;
    animation: slideInUp 0.3s ease-out;
  `;

  document.body.appendChild(statusDiv);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    statusDiv.style.animation = 'slideOutDown 0.3s ease-out';
    setTimeout(() => statusDiv.remove(), 300);
  }, 5000);
}

// Update reconnection status messages
async function initializeReconnection() {
  showReconnectionStatus('Searching for saved connections...', 'info');

  try {
    const result = await mesh.reconnectToMesh();

    if (result.peersConnected > 0) {
      showReconnectionStatus(`Connected to ${result.peersConnected} peer(s)!`, 'success');
    } else if (result.method === 'fallback_required') {
      showReconnectionStatus('No saved connections found', 'info');
    }
  } catch (error) {
    showReconnectionStatus('Reconnection failed', 'error');
  }
}

// ============================================
// 3. MANUAL RECONNECTION BUTTON
// ============================================

// Add a manual reconnection button to your UI (in HTML)
/*
<button class="btn-reconnect" id="btnReconnect" title="Reconnect to saved peers">
  <i class="ti ti-refresh"></i>
  <span>Reconnect</span>
</button>
*/

// Add handler in app.js
$('btnReconnect').onclick = async () => {
  const btn = $('btnReconnect');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i><span>Connecting...</span>';

  try {
    const result = await mesh.reconnectToMesh();

    if (result.peersConnected > 0) {
      addMessage(`Reconnected to ${result.peersConnected} peer(s)!`, 'system');
      showReconnectionStatus(`Connected to ${result.peersConnected} peer(s)!`, 'success');
    } else {
      addMessage('No saved peers available for reconnection', 'system');
    }
  } catch (error) {
    console.error('Reconnection error:', error);
    addMessage('Reconnection failed', 'system');
    showReconnectionStatus('Reconnection failed', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-refresh"></i><span>Reconnect</span>';
  }
};

// ============================================
// 4. PERIODIC RECONNECTION CHECK
// ============================================

// Optionally check for disconnected peers and attempt reconnection
function startPeriodicReconnectionCheck(interval = 300000) { // 5 minutes
  return setInterval(async () => {
    if (!mesh.reconnectionEnabled) return;

    // Get saved peers
    const savedPeers = await mesh.peerPersistence.getReconnectionCandidates({
      limit: 10,
      maxAge: 24 * 60 * 60 * 1000 // Last 24 hours
    });

    // Check which saved peers we're NOT connected to
    const disconnectedPeers = savedPeers.filter(candidate => {
      return !mesh.peers.has(candidate.peer.peerId);
    });

    if (disconnectedPeers.length > 0) {
      console.log(`[App] Found ${disconnectedPeers.length} disconnected peers, attempting reconnection...`);

      for (const candidate of disconnectedPeers.slice(0, 3)) { // Limit to 3 at a time
        const result = await mesh.masterReconnect.reconnectToPeer(candidate.peer);
        if (result.success) {
          console.log(`[App] Reconnected to ${candidate.peer.displayName}`);
          addMessage(`Reconnected to ${candidate.peer.displayName}`, 'system');
        }

        // Small delay between attempts
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }, interval);
}

// Start periodic check
const reconnectionCheckInterval = startPeriodicReconnectionCheck();

// Stop on page unload
window.addEventListener('beforeunload', () => {
  clearInterval(reconnectionCheckInterval);
});

// ============================================
// 5. NETWORK CHANGE HANDLING
// ============================================

// Show notification when network changes
window.addEventListener('online', () => {
  console.log('[App] Browser back online, checking for reconnection...');
  addMessage('Network connection restored, reconnecting...', 'system');
  showReconnectionStatus('Network restored, reconnecting...', 'info');

  // Give network time to stabilize, then reconnect
  setTimeout(async () => {
    try {
      const result = await mesh.reconnectToMesh();
      if (result.peersConnected > 0) {
        addMessage(`Reconnected to ${result.peersConnected} peer(s)!`, 'system');
      }
    } catch (error) {
      console.error('[App] Reconnection after online event failed:', error);
    }
  }, 3000);
});

window.addEventListener('offline', () => {
  console.log('[App] Browser offline');
  addMessage('Network connection lost', 'system');
  showReconnectionStatus('Network connection lost', 'error');
});

// ============================================
// 6. SHOW RECONNECTION STATISTICS
// ============================================

// Add a debug command to show reconnection stats
window.showReconnectionStats = () => {
  const stats = mesh.getReconnectionStats();
  if (!stats) {
    console.log('Reconnection system not enabled');
    return;
  }

  console.log('='.repeat(50));
  console.log('RECONNECTION SYSTEM STATISTICS');
  console.log('='.repeat(50));

  if (stats.master) {
    console.log('\n📊 Master Strategy:');
    console.log('  Total attempts:', stats.master.totalReconnectionAttempts);
    console.log('  Successful:', stats.master.successfulReconnections);
    console.log('  Failed:', stats.master.failedReconnections);
    console.log('  Success rate:',
      stats.master.totalReconnectionAttempts > 0
        ? `${((stats.master.successfulReconnections / stats.master.totalReconnectionAttempts) * 100).toFixed(1)}%`
        : 'N/A'
    );
  }

  if (stats.persistence) {
    console.log('\n💾 Persistence:');
    console.log('  Total saved peers:', stats.persistence.totalPeers);
    console.log('  Needs cleanup:', stats.persistence.needsCleanup);
  }

  if (stats.network) {
    console.log('\n🌐 Network:');
    console.log('  IP changes:', stats.network.ipChangeCount);
    console.log('  Connection type:', stats.network.currentConnectionType);
    console.log('  Online:', stats.network.isOnline);
  }

  console.log('\n' + '='.repeat(50));

  // Also show in UI
  const statsText = `
Reconnection Stats:
• Attempts: ${stats.master?.totalReconnectionAttempts || 0}
• Successful: ${stats.master?.successfulReconnections || 0}
• Saved Peers: ${stats.persistence?.totalPeers || 0}
• IP Changes: ${stats.network?.ipChangeCount || 0}
  `.trim();

  addMessage(statsText, 'system');
};

// Make it available in console
console.log('💡 Tip: Use window.showReconnectionStats() to see reconnection statistics');

// ============================================
// 7. CLEANUP ON LOGOUT
// ============================================

// If you have a logout function, add cleanup
function logout() {
  // Existing logout code...

  // NEW: Optional - clear reconnection data on logout
  if (confirm('Clear saved peer connections?')) {
    if (mesh.peerPersistence) {
      mesh.peerPersistence.clearAll();
      console.log('[App] Cleared all saved connections');
    }
  }

  // Destroy network
  mesh.destroy();
}

// ============================================
// 8. SHOW SAVED PEERS LIST
// ============================================

// Add a UI element to show saved peers
async function showSavedPeers() {
  if (!mesh.peerPersistence) {
    addMessage('Peer persistence not available', 'system');
    return;
  }

  const candidates = await mesh.peerPersistence.getReconnectionCandidates({
    limit: 20,
    maxAge: 7 * 24 * 60 * 60 * 1000 // Last 7 days
  });

  if (candidates.length === 0) {
    addMessage('No saved peers found', 'system');
    return;
  }

  let message = `📋 Saved Peers (${candidates.length}):\n\n`;
  for (const candidate of candidates.slice(0, 10)) {
    const peer = candidate.peer;
    const lastSeen = new Date(peer.lastSeen).toLocaleString();
    const status = mesh.peers.has(peer.peerId) ? '🟢 Connected' : '⚪ Disconnected';
    message += `${status} ${peer.displayName} (score: ${candidate.score})\n`;
    message += `   Last seen: ${lastSeen}\n\n`;
  }

  addMessage(message, 'system');
}

// Make it available in console
window.showSavedPeers = showSavedPeers;
console.log('💡 Tip: Use window.showSavedPeers() to see saved peer connections');

// ============================================
// 9. ERROR RECOVERY UI
// ============================================

// Show user-friendly errors for reconnection failures
mesh.masterReconnect.on('reconnection_failed', (event) => {
  const { peerId, reason, attempt } = event;

  if (attempt >= 3) {
    // Give up after 3 attempts
    addMessage(`Failed to reconnect to peer after ${attempt} attempts`, 'system');
  } else {
    console.log(`[App] Reconnection attempt ${attempt} failed: ${reason}`);
  }
});

// ============================================
// 10. ANNOUNCEMENT WHEN PEER RECONNECTS TO US
// ============================================

// Show message when a peer reconnects to us
mesh.onPeerConnect = (uuid, displayName) => {
  // Check if this is a reconnection (peer was in saved peers)
  if (mesh.peerPersistence) {
    mesh.peerPersistence.getPeer(uuid).then(savedPeer => {
      if (savedPeer) {
        const lastConnected = new Date(savedPeer.lastConnected);
        const now = new Date();
        const hoursSince = (now - lastConnected) / (1000 * 60 * 60);

        if (hoursSince > 1) {
          // Was disconnected for more than 1 hour
          addMessage(`${displayName} reconnected after ${Math.floor(hoursSince)} hours! 🎉`, 'system');
        } else {
          addMessage(`${displayName} reconnected!`, 'system');
        }
      } else {
        // New connection
        addMessage(`${displayName} connected!`, 'system');
      }
    });
  } else {
    // Fallback to simple message
    addMessage(`${displayName} connected!`, 'system');
  }

  // Update UI
  updatePeerList();
};

// ============================================
// INTEGRATION CHECKLIST
// ============================================
/*
 * 1. ✅ Add initializeReconnection() function (section 1)
 * 2. ✅ Call initializeReconnection() on DOMContentLoaded
 * 3. ✅ Add showReconnectionStatus() helper (section 2)
 * 4. ✅ Add manual reconnection button handler (section 3)
 * 5. ✅ Optional: Start periodic reconnection check (section 4)
 * 6. ✅ Add network change handlers (section 5)
 * 7. ✅ Add showReconnectionStats() debug function (section 6)
 * 8. ✅ Add cleanup to logout function (section 7)
 * 9. ✅ Add showSavedPeers() UI function (section 8)
 * 10. ✅ Enhance onPeerConnect callback (section 10)
 */

// ============================================
// TESTING
// ============================================
/*
 * Test scenarios:
 *
 * 1. Page Refresh Test:
 *    - Connect to 2-3 peers
 *    - Refresh page (F5)
 *    - Should automatically reconnect within 10-30 seconds
 *
 * 2. Cold Start Test:
 *    - Connect to 2-3 peers
 *    - Close all tabs
 *    - Reopen app in new tab
 *    - Should attempt reconnection (may fail if peers offline)
 *
 * 3. Network Change Test:
 *    - Connect to peers
 *    - Turn off WiFi, then turn back on
 *    - Should detect network change and reconnect
 *
 * 4. IP Change Test (advanced):
 *    - Connect to peers on WiFi
 *    - Switch to mobile hotspot (different network)
 *    - Should detect IP change and announce to mesh
 *
 * 5. Manual Reconnect Test:
 *    - Have saved peers but disconnected
 *    - Click reconnect button
 *    - Should attempt to reconnect to saved peers
 *
 * Debug commands:
 * - window.showReconnectionStats() - Show statistics
 * - window.showSavedPeers() - Show saved peer list
 * - mesh.getReconnectionStats() - Get raw stats object
 * - mesh.networkDetector.getStats() - Get network stats
 */

export { initializeReconnection, showReconnectionStatus, showSavedPeers };
