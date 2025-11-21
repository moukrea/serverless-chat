# Master Reconnection Strategy - Integration Guide

## Overview

The `MasterReconnectionStrategy` provides a unified, production-ready interface for all reconnection scenarios in your P2P mesh chat application. It intelligently handles both cold start (0 connections) and warm start (has connections) scenarios with cascading fallback strategies.

## Quick Start

### 1. Basic Initialization

```javascript
import MasterReconnectionStrategy from './reconnection/master-reconnection.js';
import ReconnectionAuth from './reconnection-auth.js';
import peerPersistence from './storage/peer-persistence.js';

// Initialize the master reconnection strategy
const masterReconnect = new MasterReconnectionStrategy(
  identity,          // { uuid/peerId, displayName, approvedPeers }
  messageRouter,     // MessageRouter instance
  meshNetwork,       // MeshNetwork instance (peer manager)
  peerPersistence,   // PeerPersistenceManager
  reconnectionAuth   // ReconnectionAuth instance
);
```

### 2. Simple Usage (Automatic Strategy Selection)

```javascript
// On page refresh or network reconnection
const result = await masterReconnect.reconnectToMesh();

if (result.success) {
  console.log(`✅ Reconnected to ${result.peersConnected} peers via ${result.method}`);
  console.log(`   Duration: ${result.duration}ms`);
} else {
  console.error(`❌ Reconnection failed: ${result.method}`);

  if (result.fallbackRequired) {
    // Show pairing UI to user
    showPairingInterface();
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              MasterReconnectionStrategy                     │
│                                                               │
│  Decision Logic: Cold Start vs Warm Start                   │
│  ├─ 0 connections? → Cold Start (multi-layer fallback)     │
│  └─ Has connections? → Warm Start (mesh relay)             │
│                                                               │
│  Manages:                                                    │
│  ├─ DirectReconnectionManager (fast, 5-20% success)        │
│  ├─ ReconnectionManager (mesh relay, 70-80% success)       │
│  ├─ MeshAnnouncementManager (gossip announcements)         │
│  ├─ ColdStartManager (0 connections recovery)              │
│  └─ MeshTopologyManager (optional, future)                 │
└─────────────────────────────────────────────────────────────┘
```

## Integration Scenarios

### Scenario 1: Page Refresh

```javascript
// app.js - On page load
window.addEventListener('DOMContentLoaded', async () => {
  // Initialize identity, network, etc.
  await initializeApplication();

  // Initialize master reconnection strategy
  const masterReconnect = new MasterReconnectionStrategy(
    identity,
    messageRouter,
    meshNetwork,
    peerPersistence,
    reconnectionAuth
  );

  // Attempt automatic reconnection
  console.log('Attempting automatic reconnection...');
  const result = await masterReconnect.reconnectToMesh();

  if (result.success) {
    if (result.method === 'cold_start') {
      showNotification('Recovered from cold start', 'success');
    } else {
      showNotification(`Reconnected to ${result.peersConnected} peers`, 'success');
    }
  } else {
    if (result.fallbackRequired) {
      // Show initial pairing UI
      showPairingUI();
    } else {
      showNotification('Reconnection in progress...', 'info');
    }
  }

  // Store for later use
  window.masterReconnect = masterReconnect;
});
```

### Scenario 2: Network Change Detection

```javascript
// Listen for network changes (IP change, network switch, etc.)
window.addEventListener('online', async () => {
  console.log('Network came back online');

  // Announce IP change to mesh
  await window.masterReconnect.handleIpChange();

  // Optionally trigger full reconnection
  // await window.masterReconnect.reconnectToMesh();
});

window.addEventListener('offline', () => {
  console.log('Network went offline');
  showNotification('Network disconnected', 'warning');
});
```

### Scenario 3: Manual Reconnection Button

```javascript
// UI: Add reconnection button
document.getElementById('reconnect-btn').addEventListener('click', async () => {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Reconnecting...';

  const result = await window.masterReconnect.reconnectToMesh();

  if (result.success) {
    showNotification(
      `Connected to ${result.peersConnected} peers in ${result.duration}ms`,
      'success'
    );
  } else {
    showNotification('Reconnection failed, please try again', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Reconnect';
});
```

### Scenario 4: Monitor Peer Connections

```javascript
// Monitor for peer disconnections
meshNetwork.on('peer-disconnected', async (peerId, peerName) => {
  console.log(`Peer disconnected: ${peerName}`);

  // If we lose all connections, trigger cold start
  const connectedCount = meshNetwork.getConnectedPeerCount();

  if (connectedCount === 0) {
    console.log('All peers disconnected, attempting recovery...');

    // Wait a bit to see if they come back
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check again
    const stillDisconnected = meshNetwork.getConnectedPeerCount() === 0;

    if (stillDisconnected) {
      console.log('Still disconnected, initiating cold start recovery...');
      await window.masterReconnect.reconnectToMesh();
    }
  }
});

// Monitor new peer connections for caching
meshNetwork.on('peer-connected', (peerId, peerName, peer) => {
  console.log(`New peer connected: ${peerName}`);

  // Start monitoring for direct reconnection cache
  window.masterReconnect.directReconnect.monitorPeerConnection(
    peerId,
    peerName,
    peer
  );
});
```

### Scenario 5: Statistics Dashboard

```javascript
// Display reconnection statistics
function updateReconnectionStats() {
  const stats = window.masterReconnect.getStats();

  document.getElementById('total-attempts').textContent = stats.totalAttempts;
  document.getElementById('success-rate').textContent = stats.successRate;
  document.getElementById('avg-duration').textContent = `${stats.averageDuration}ms`;
  document.getElementById('cold-starts').textContent = stats.coldStarts;
  document.getElementById('warm-starts').textContent = stats.warmStarts;

  // Method breakdown
  const methodBreakdown = stats.methodBreakdown;
  console.log('Reconnection methods used:');
  console.log(`  Direct: ${methodBreakdown.direct_cached}`);
  console.log(`  Mesh Relay: ${methodBreakdown.mesh_relay}`);
  console.log(`  Cold Start: ${methodBreakdown.cold_start}`);
  console.log(`  Failed: ${methodBreakdown.failed}`);
}

// Update stats every 30 seconds
setInterval(updateReconnectionStats, 30000);
```

## Configuration Options

### Default Configuration

```javascript
const masterReconnect = new MasterReconnectionStrategy(
  identity,
  messageRouter,
  meshNetwork,
  peerPersistence,
  reconnectionAuth,
  {
    // Override defaults here
    TIMEOUTS: {
      DIRECT: 8000,        // 8s for direct reconnection
      MESH_RELAY: 20000,   // 20s for mesh relay
      TOTAL_PER_PEER: 30000, // 30s total per peer
    },

    WARM_START: {
      MAX_PEERS_TO_RECONNECT: 10,     // Max peers to reconnect
      PARALLEL_ATTEMPTS: false,        // Sequential attempts
      EARLY_EXIT_THRESHOLD: null,      // Try all peers (no early exit)
    },

    COLD_START: {
      MAX_DURATION: 40000,    // 40s maximum for cold start
      AUTO_FALLBACK: true,     // Auto show pairing UI on failure
    },

    POST_RECONNECTION: {
      ENABLE_PERIODIC_ANNOUNCEMENTS: true,
      ENABLE_TOPOLOGY_DISCOVERY: true,
      UPDATE_PERSISTENCE: true,
    },
  }
);
```

### Advanced Configuration Examples

#### Fast Reconnection (Lower Timeouts)
```javascript
const fastReconnect = new MasterReconnectionStrategy(
  identity,
  messageRouter,
  meshNetwork,
  peerPersistence,
  reconnectionAuth,
  {
    TIMEOUTS: {
      DIRECT: 5000,        // 5s
      MESH_RELAY: 15000,   // 15s
      TOTAL_PER_PEER: 20000, // 20s
    },
    WARM_START: {
      EARLY_EXIT_THRESHOLD: 3, // Stop after 3 connections
    },
  }
);
```

#### Conservative Reconnection (Higher Success Rate)
```javascript
const conservativeReconnect = new MasterReconnectionStrategy(
  identity,
  messageRouter,
  meshNetwork,
  peerPersistence,
  reconnectionAuth,
  {
    TIMEOUTS: {
      DIRECT: 10000,       // 10s
      MESH_RELAY: 30000,   // 30s
      TOTAL_PER_PEER: 40000, // 40s
    },
    WARM_START: {
      MAX_PEERS_TO_RECONNECT: 15,
    },
  }
);
```

## API Reference

### Main Methods

#### `reconnectToMesh()`
Main entry point for all reconnection scenarios.

```javascript
const result = await masterReconnect.reconnectToMesh();
// Returns: {
//   success: boolean,
//   method: string,              // 'cold_start', 'warm_reconnection', etc.
//   peersConnected: number,
//   duration: number,            // milliseconds
//   attempts: Array<string>,     // strategies attempted
//   fallbackRequired?: boolean   // if manual intervention needed
// }
```

#### `reconnectToPeer(peer)`
Reconnect to a specific peer with cascading fallback.

```javascript
const peer = await peerPersistence.getPeer(peerId);
const result = await masterReconnect.reconnectToPeer(peer);
// Returns: {
//   success: boolean,
//   method?: string,   // 'direct_cached', 'mesh_relay'
//   reason?: string,   // failure reason if unsuccessful
//   duration: number
// }
```

#### `handleIpChange()`
Handle IP address change scenario.

```javascript
await masterReconnect.handleIpChange();
// Returns: boolean (success status)
```

#### `getDesiredPeers()`
Get prioritized list of peers for reconnection.

```javascript
const peers = await masterReconnect.getDesiredPeers();
// Returns: Array<PeerData> (sorted by priority)
```

#### `getStats()`
Get comprehensive statistics.

```javascript
const stats = masterReconnect.getStats();
// Returns: {
//   totalAttempts: number,
//   successfulReconnections: number,
//   failedReconnections: number,
//   coldStarts: number,
//   warmStarts: number,
//   averageDuration: number,
//   successRate: string,
//   methodBreakdown: {
//     direct_cached: number,
//     mesh_relay: number,
//     cold_start: number,
//     failed: number
//   },
//   lastResult: Object,
//   directReconnection: Object,
//   meshRelay: Object,
//   announcements: Object,
//   coldStart: Object
// }
```

#### `destroy()`
Cleanup and stop all managers.

```javascript
masterReconnect.destroy();
```

### Helper Methods

#### `isCurrentlyReconnecting()`
Check if reconnection is in progress.

```javascript
if (masterReconnect.isCurrentlyReconnecting()) {
  console.log('Reconnection already in progress');
}
```

#### `getLastReconnectionResult()`
Get result of last reconnection attempt.

```javascript
const lastResult = masterReconnect.getLastReconnectionResult();
```

#### `postReconnectionSetup()`
Manually trigger post-reconnection setup.

```javascript
await masterReconnect.postReconnectionSetup();
```

## Flow Diagrams

### Cold Start Flow (0 Connections)
```
User Refreshes Page
        ↓
No Active Connections
        ↓
┌───────────────────────┐
│ Layer 1: Recent Peers │ (< 5 min, parallel, 10s timeout)
└───────┬───────────────┘
        │ Failed
        ↓
┌───────────────────────┐
│ Layer 2: Knock Proto  │ (experimental NAT wake-up)
└───────┬───────────────┘
        │ Failed
        ↓
┌───────────────────────┐
│ Layer 3: All Peers    │ (< 24h, parallel, 15s timeout)
└───────┬───────────────┘
        │ Failed
        ↓
┌───────────────────────┐
│ Layer 4: Pairing UI   │ (manual intervention)
└───────────────────────┘
```

### Warm Start Flow (Has Connections)
```
User Refreshes Page
        ↓
Has Active Connections
        ↓
Announce Presence to Mesh
        ↓
Discover Topology (optional)
        ↓
Get Desired Peers (from persistence)
        ↓
For Each Peer:
    ├─ Try Direct (8s)
    │       │ Success → Done
    │       │ Failed ↓
    └─ Try Mesh Relay (20s)
            │ Success → Done
            │ Failed → Next Peer
```

### Per-Peer Reconnection Flow
```
Target Peer
    ↓
┌──────────────────────────┐
│ Strategy 1: Direct       │
│ - Cached ICE candidates  │
│ - 8 second timeout       │
│ - 5-20% success rate     │
└──────────┬───────────────┘
           │ Failed
           ↓
┌──────────────────────────┐
│ Strategy 2: Mesh Relay   │
│ - Route through mesh     │
│ - 20 second timeout      │
│ - 70-80% success rate    │
└──────────┬───────────────┘
           │ Failed
           ↓
     All Failed
```

## Best Practices

### 1. Initialize Early
```javascript
// Initialize as soon as possible after app load
window.addEventListener('DOMContentLoaded', async () => {
  // ... initialize identity, network, etc.

  // Initialize master reconnection BEFORE attempting connections
  window.masterReconnect = new MasterReconnectionStrategy(...);

  // Then attempt reconnection
  await window.masterReconnect.reconnectToMesh();
});
```

### 2. Monitor Active Connections
```javascript
// Monitor for peer caching
meshNetwork.on('peer-connected', (peerId, peerName, peer) => {
  // Cache connection data for future reconnections
  masterReconnect.directReconnect.monitorPeerConnection(
    peerId,
    peerName,
    peer
  );
});
```

### 3. Handle Edge Cases
```javascript
// Check for concurrent reconnection attempts
if (masterReconnect.isCurrentlyReconnecting()) {
  console.warn('Reconnection already in progress, skipping');
  return;
}

// Handle total disconnection
if (connectedPeerCount === 0) {
  // Wait briefly before triggering cold start
  await new Promise(resolve => setTimeout(resolve, 5000));

  if (meshNetwork.getConnectedPeerCount() === 0) {
    await masterReconnect.reconnectToMesh();
  }
}
```

### 4. Cleanup on Shutdown
```javascript
window.addEventListener('beforeunload', () => {
  // Clean up reconnection system
  if (window.masterReconnect) {
    window.masterReconnect.destroy();
  }
});
```

### 5. User Feedback
```javascript
// Show progress to user
async function reconnectWithFeedback() {
  showNotification('Reconnecting...', 'info');

  const result = await masterReconnect.reconnectToMesh();

  if (result.success) {
    showNotification(
      `Connected to ${result.peersConnected} peers (${result.method})`,
      'success'
    );
  } else {
    if (result.fallbackRequired) {
      showNotification('Please scan QR code to reconnect', 'warning');
      showPairingUI();
    } else {
      showNotification('Reconnection failed, please try again', 'error');
    }
  }
}
```

## Troubleshooting

### Problem: Reconnection takes too long
**Solution:** Reduce timeouts
```javascript
new MasterReconnectionStrategy(..., {
  TIMEOUTS: {
    DIRECT: 5000,
    MESH_RELAY: 15000,
  },
  WARM_START: {
    EARLY_EXIT_THRESHOLD: 3,
  }
});
```

### Problem: Cold start always fails
**Solution:** Check peer persistence and approval status
```javascript
// Verify peers are stored
const stats = await peerPersistence.getStorageStats();
console.log('Stored peers:', stats.peerCount);

// Verify peers are approved
const approvedCount = Object.keys(identity.approvedPeers).length;
console.log('Approved peers:', approvedCount);
```

### Problem: Mesh relay doesn't work
**Solution:** Verify router and announcements
```javascript
// Check if router is initialized
console.log('Router initialized:', !!messageRouter);

// Check if announcements are working
const announcementStats = masterReconnect.announcements.getStats();
console.log('Announcements sent:', announcementStats.announcementsSent);
```

### Problem: Direct reconnection never succeeds
**Solution:** Ensure monitoring is enabled
```javascript
// Monitor all peer connections
meshNetwork.on('peer-connected', (peerId, peerName, peer) => {
  masterReconnect.directReconnect.monitorPeerConnection(
    peerId,
    peerName,
    peer
  );
});
```

## Performance Considerations

- **Cold Start**: Can take up to 40 seconds in worst case
- **Warm Start**: Typically 10-30 seconds depending on peer count
- **Direct Reconnection**: 2-8 seconds when successful
- **Mesh Relay**: 10-25 seconds typical
- **Memory**: Minimal overhead, ~1-2MB total for all managers
- **Storage**: Uses localStorage for persistence (5MB target)

## Security Considerations

- All announcements are cryptographically signed (Ed25519)
- TOFU (Trust On First Use) for peer authentication
- Nonce-based replay protection
- Sequence number rollback prevention
- Encrypted persistence storage

## License

Same as parent project
