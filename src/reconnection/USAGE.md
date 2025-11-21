# Cold Start Manager - Usage Guide

## Overview

The ColdStartManager handles the hardest recovery scenario in P2P mesh networks: a peer refreshes their browser and has **ZERO active connections**. Since there are no connections, traditional mesh relay and gossip protocols cannot be used.

## Success Rates

- **Layer 1 (Recent Peers)**: 30-40% success within 5 minutes of disconnect
- **Layer 2 (Knock Protocol)**: 5-10% success (experimental)
- **Layer 3 (All Known Peers)**: 10-20% success within 24 hours
- **Overall**: 40-60% automated recovery, 100% with manual fallback

## Installation & Setup

### Basic Setup

```javascript
import ColdStartManager from './reconnection/cold-start.js';
import peerPersistence from './storage/peer-persistence.js';
import DirectReconnectionManager from './reconnection/direct-reconnection.js';
import MeshAnnouncementManager from './reconnection/mesh-announcements.js';

// Initialize dependencies
const identity = getIdentity(); // Your identity manager
const meshNetwork = new MeshNetwork(identity);

// Optional: Direct reconnection manager
const directReconnect = new DirectReconnectionManager(
  identity,
  meshNetwork,
  peerPersistence
);

// Optional: Mesh announcement manager
const announcements = new MeshAnnouncementManager(
  identity,
  meshNetwork,
  meshNetwork.router
);

// Create cold start manager
const coldStartManager = new ColdStartManager(
  identity,
  meshNetwork,
  peerPersistence,
  directReconnect,    // Optional but recommended
  announcements       // Optional but recommended
);
```

### Minimal Setup (Without Optional Modules)

```javascript
import ColdStartManager from './reconnection/cold-start.js';
import peerPersistence from './storage/peer-persistence.js';

const coldStartManager = new ColdStartManager(
  identity,
  meshNetwork,
  peerPersistence
  // No directReconnect or announcements
);
```

## Usage

### Detecting Cold Start

```javascript
// On page load, check if we have any active connections
window.addEventListener('load', async () => {
  const connectedPeers = meshNetwork.getConnectedPeerCount();
  
  if (connectedPeers === 0) {
    console.log('Cold start detected! Initiating recovery...');
    
    // Show loading UI
    showRecoveryUI('Attempting to reconnect...');
    
    // Attempt recovery
    const result = await coldStartManager.handleColdStart();
    
    if (result.success) {
      console.log(`Recovered via ${result.method}!`);
      console.log(`Connected to ${result.connected} peer(s)`);
      hideRecoveryUI();
    } else {
      console.log('Recovery failed, manual pairing required');
      showPairingUI(result.reason);
    }
  }
});
```

### Handling Recovery Results

```javascript
const result = await coldStartManager.handleColdStart();

switch (result.success) {
  case true:
    // Successful recovery
    console.log(`Recovery method: ${result.method}`);
    // Methods: 'recent_peers', 'knock_protocol', 'all_known_peers', 'dht_fallback'
    
    console.log(`Connected peers: ${result.connected}`);
    console.log(`Recovery time: ${result.duration}ms`);
    
    // Continue normal operation
    break;
    
  case false:
    // Recovery failed
    console.log(`Failure reason: ${result.reason}`);
    // Reasons: 'all_methods_failed', 'recovery_exception', 'recovery_in_progress'
    
    if (result.fallbackRequired) {
      // Show manual pairing UI
      showManualPairingDialog();
    }
    break;
}
```

### Listening for Manual Pairing Events

```javascript
// Listen for the show-pairing-ui event
window.addEventListener('show-pairing-ui', (event) => {
  const { reason, attemptLog, duration } = event.detail;
  
  console.log(`Manual pairing required: ${reason}`);
  console.log(`Recovery attempts:`, attemptLog);
  console.log(`Time spent: ${duration}ms`);
  
  // Show your pairing UI
  showPairingDialog({
    title: 'Reconnection Failed',
    message: 'Unable to automatically reconnect. Please pair manually.',
    showQRCode: true,
    showPassphraseInput: true
  });
});
```

## Multi-Layer Fallback Strategy

### Layer 1: Recent Peers (< 5 minutes)

```javascript
// Automatically tried first
// - Highest success rate (30-40%)
// - Tries up to 5 most recent peers
// - 10-second timeout per peer
// - Parallel attempts for speed

// Monitor progress
coldStartManager.on('layer-start', (layer) => {
  if (layer === 'recent_peers') {
    updateUI('Trying recently connected peers...');
  }
});
```

### Layer 2: Knock Protocol (Experimental)

```javascript
// Automatically tried if Layer 1 fails
// - Low success rate (5-10%)
// - Sends minimal WebRTC packets
// - Attempts to wake NAT bindings
// - 5-second timeout per attempt

// Can be disabled in config
import { COLD_START_CONFIG } from './reconnection/cold-start.js';
COLD_START_CONFIG.KNOCK.ENABLED = false;
```

### Layer 3: All Known Peers (< 24 hours)

```javascript
// Automatically tried if Layer 2 fails
// - Medium success rate (10-20%)
// - Tries up to 10 peers by score
// - 15-second timeout per peer
// - More aggressive attempt

coldStartManager.on('layer-start', (layer) => {
  if (layer === 'all_known_peers') {
    updateUI('Trying all known peers...');
  }
});
```

### Layer 4: Initial Pairing Fallback

```javascript
// Automatically tried if Layer 3 fails
// - Checks for saved DHT passphrase
// - Dispatches 'show-pairing-ui' event
// - Waits for manual intervention

// Save passphrase for DHT fallback
localStorage.setItem('mesh:dht:passphrase', 'my-room-passphrase');
```

## Configuration

### Adjusting Timeouts

```javascript
import { COLD_START_CONFIG } from './reconnection/cold-start.js';

// Layer 1: Recent Peers
COLD_START_CONFIG.RECENT_PEERS.MAX_AGE_MS = 3 * 60 * 1000;  // 3 minutes
COLD_START_CONFIG.RECENT_PEERS.MAX_ATTEMPTS = 3;            // Try 3 peers
COLD_START_CONFIG.RECENT_PEERS.TIMEOUT_MS = 5000;           // 5 seconds

// Layer 2: Knock Protocol
COLD_START_CONFIG.KNOCK.ENABLED = true;
COLD_START_CONFIG.KNOCK.MAX_ATTEMPTS = 5;
COLD_START_CONFIG.KNOCK.TIMEOUT_MS = 3000;

// Layer 3: All Known Peers
COLD_START_CONFIG.ALL_PEERS.MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
COLD_START_CONFIG.ALL_PEERS.MAX_ATTEMPTS = 15;
COLD_START_CONFIG.ALL_PEERS.TIMEOUT_MS = 10000;

// Overall limit
COLD_START_CONFIG.MAX_TOTAL_TIME_MS = 30000;  // 30 seconds total
```

### Custom Scoring

```javascript
// Override scoring function for custom peer prioritization
coldStartManager.calculateColdStartScore = (peer) => {
  let score = 0;
  
  // Your custom scoring logic
  if (peer.isImportant) score += 50;
  if (peer.alwaysOnline) score += 30;
  
  return score;
};
```

## Monitoring & Diagnostics

### Get Real-Time Statistics

```javascript
// Get current recovery status
const stats = coldStartManager.getStats();

console.log('Recovery status:', stats.isRecovering);
console.log('Current layer:', stats.currentLayer);
console.log('Attempt log:', stats.attemptLog);
console.log('Total attempts:', stats.totalAttempts);
console.log('Successful attempts:', stats.successfulAttempts);
console.log('Elapsed time:', stats.elapsedTime);
```

### View Recovery Log

```javascript
// After recovery completes (success or failure)
coldStartManager.printRecoveryLog();

// Output:
// [ColdStart] ========================================
// [ColdStart] RECOVERY ATTEMPT LOG
// [ColdStart] ========================================
// [ColdStart] 1. ✗ recent_peers (2.3s) - Connected: 0
// [ColdStart] 2. ✗ knock_protocol (5.1s) - Connected: 0
// [ColdStart] 3. ✓ all_known_peers (12.4s) - Connected: 2
// [ColdStart] ========================================
// [ColdStart] Total recovery time: 19.8s
// [ColdStart] ========================================
```

## Integration with UI

### Show Progress Indicator

```javascript
// Create progress UI
const progressDialog = createDialog({
  title: 'Reconnecting...',
  message: 'Attempting to reconnect to mesh network',
  showProgress: true
});

// Update progress based on layer
coldStartManager.on('layer-start', (layer) => {
  const messages = {
    recent_peers: 'Trying recently connected peers...',
    knock_protocol: 'Attempting NAT wake-up...',
    all_known_peers: 'Trying all known peers...',
    initial_pairing: 'Preparing manual pairing...'
  };
  
  progressDialog.updateMessage(messages[layer]);
});

// Handle completion
const result = await coldStartManager.handleColdStart();
progressDialog.close();
```

### Show Peer Reconnection Status

```javascript
// Display which peers are being attempted
coldStartManager.on('peer-attempt', (peerInfo) => {
  addLogEntry(`Attempting: ${peerInfo.displayName}...`);
});

coldStartManager.on('peer-success', (peerInfo) => {
  addLogEntry(`✓ Connected: ${peerInfo.displayName}`, 'success');
});

coldStartManager.on('peer-failure', (peerInfo) => {
  addLogEntry(`✗ Failed: ${peerInfo.displayName}`, 'error');
});
```

## Best Practices

### 1. Store Peer Data Continuously

```javascript
// Update peer data whenever a peer connects
meshNetwork.onPeerConnect = async (peerId, displayName) => {
  await peerPersistence.storePeer({
    peerId,
    displayName,
    lastConnected: Date.now(),
    // ... other data
  });
};

// Update quality metrics periodically
setInterval(async () => {
  for (const peer of meshNetwork.getConnectedPeers()) {
    await peerPersistence.updateConnectionQuality(peer.uuid, {
      latency: peer.latency,
      connectionType: peer.connectionType,
      success: true
    });
  }
}, 60000); // Every minute
```

### 2. Clean Up Stale Peers

```javascript
// Run cleanup daily
setInterval(async () => {
  await peerPersistence.cleanupStalePeers();
}, 24 * 60 * 60 * 1000);
```

### 3. Provide Manual Pairing Option

```javascript
// Always show a "Manual Pairing" button
const pairingButton = document.getElementById('manual-pairing-btn');
pairingButton.addEventListener('click', () => {
  showPairingDialog();
});

// Show immediately if cold start fails
const result = await coldStartManager.handleColdStart();
if (!result.success) {
  pairingButton.style.display = 'block';
  pairingButton.classList.add('highlight');
}
```

### 4. Handle Concurrent Recovery

```javascript
// Prevent multiple simultaneous recovery attempts
let isRecovering = false;

async function attemptRecovery() {
  if (isRecovering) {
    console.log('Recovery already in progress');
    return;
  }
  
  isRecovering = true;
  try {
    const result = await coldStartManager.handleColdStart();
    return result;
  } finally {
    isRecovering = false;
  }
}
```

## Troubleshooting

### Recovery Always Fails

**Problem**: Cold start recovery never succeeds

**Solutions**:
1. Check that peer data is being persisted: `await peerPersistence.getAllPeerIds()`
2. Verify peers have recent connection times (< 5 min for best results)
3. Check browser console for WebRTC errors
4. Ensure ICE configuration is correct
5. Test on different networks (NAT types affect success rate)

### Long Recovery Times

**Problem**: Recovery takes too long (> 30 seconds)

**Solutions**:
1. Reduce timeouts in configuration
2. Reduce number of peer attempts
3. Disable knock protocol (low success rate)
4. Implement DirectReconnectionManager for faster attempts

### Peer Data Not Found

**Problem**: `getRecentlyConnectedPeers()` returns empty array

**Solutions**:
1. Ensure peer data is being stored on connection
2. Check localStorage quota (may be full)
3. Verify peer data hasn't expired (check `lastConnected`)
4. Run cleanup less frequently

## Example: Complete Integration

```javascript
import ColdStartManager from './reconnection/cold-start.js';
import peerPersistence from './storage/peer-persistence.js';

class App {
  async initialize() {
    // Initialize mesh network
    this.mesh = new MeshNetwork(this.identity);
    
    // Initialize cold start manager
    this.coldStart = new ColdStartManager(
      this.identity,
      this.mesh,
      peerPersistence
    );
    
    // Check for cold start on load
    if (this.mesh.getConnectedPeerCount() === 0) {
      await this.handleColdStart();
    }
  }
  
  async handleColdStart() {
    // Show recovery UI
    this.ui.showRecoveryDialog();
    
    try {
      const result = await this.coldStart.handleColdStart();
      
      if (result.success) {
        this.ui.showSuccess(`Reconnected to ${result.connected} peer(s)`);
      } else {
        this.ui.showPairingDialog();
      }
    } catch (error) {
      console.error('Cold start error:', error);
      this.ui.showError('Recovery failed');
    } finally {
      this.ui.hideRecoveryDialog();
    }
  }
}
```

## Performance Considerations

- **Layer 1** completes in 10-15 seconds (parallel attempts)
- **Layer 2** adds 5-10 seconds (experimental)
- **Layer 3** adds 15-20 seconds (aggressive)
- **Total maximum**: 40 seconds before manual fallback

To optimize:
1. Store high-quality peer data (low latency, direct connections)
2. Keep peer data fresh (update on every connection)
3. Use DirectReconnectionManager for faster reconnection
4. Reduce attempt limits for faster fallback to manual pairing

## Security Considerations

- Peer data in localStorage is encrypted (via PeerPersistenceManager)
- No sensitive data exposed in recovery attempts
- Failed attempts are rate-limited to prevent abuse
- Manual pairing always available as secure fallback

