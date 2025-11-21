# Network Change Detector

Production-ready network monitoring system for detecting network changes and IP address changes in the browser.

## Overview

The `NetworkChangeDetector` monitors the user's network connectivity and detects when their public IP address changes (e.g., switching from WiFi to cellular, reconnecting to a different network, VPN changes, etc.). When an IP change is detected, it automatically triggers announcements to the mesh network so peers can reconnect.

## Features

- ✅ **IP Change Detection** - Uses STUN servers to detect public IP changes
- ✅ **Network Connection Monitoring** - Tracks WiFi ↔ Cellular transitions
- ✅ **Online/Offline Detection** - Monitors browser connectivity state
- ✅ **Automatic Announcements** - Triggers mesh announcements on IP changes
- ✅ **Periodic Checking** - Regular IP checks every 2 minutes
- ✅ **Statistics Tracking** - Comprehensive network change statistics
- ✅ **Browser Compatibility** - Graceful degradation for older browsers
- ✅ **Production Ready** - Complete error handling and logging

## Browser APIs Used

| API | Purpose | Browser Support | Fallback |
|-----|---------|-----------------|----------|
| `navigator.connection` | Connection type detection | Chrome, Edge, Opera | Returns 'unknown' |
| `navigator.onLine` | Online/offline status | All modern browsers | N/A |
| `window online/offline` | Connectivity events | All modern browsers | N/A |
| WebRTC + STUN | Public IP detection | All modern browsers | IP detection disabled |

## Quick Start

### Basic Usage

```javascript
import NetworkChangeDetector from './network/change-detector.js';
import MeshAnnouncementManager from './reconnection/mesh-announcements.js';

// Create announcement manager
const announcementManager = new MeshAnnouncementManager(
  identity,
  router,
  peerManager,
  reconnectionAuth,
  peerPersistence
);
announcementManager.initialize();

// Create adapter
const reconnectorAdapter = {
  handleIpChange: async () => {
    return await announcementManager.announceIpChange();
  }
};

// Create and initialize detector
const networkDetector = new NetworkChangeDetector(reconnectorAdapter);
networkDetector.initialize();

// Cleanup on shutdown
window.addEventListener('beforeunload', () => {
  networkDetector.destroy();
});
```

### Complete Integration

See [`integration-example.js`](./integration-example.js) for a complete integration example with the mesh network system.

## API Reference

### Constructor

```javascript
const detector = new NetworkChangeDetector(reconnector);
```

**Parameters:**
- `reconnector` (Object) - Object with `handleIpChange()` method
  - Must implement: `async handleIpChange()` - Called when IP changes

### Methods

#### `initialize()`

Initializes the detector and starts monitoring.

```javascript
detector.initialize();
```

**Actions:**
- Sets up browser event listeners
- Starts periodic IP checking (every 2 minutes)
- Records initial connection state
- Performs delayed initial IP check (2 seconds)

#### `getPublicIP()`

Gets the current public IP address using STUN.

```javascript
const ip = await detector.getPublicIP();
console.log('Public IP:', ip); // "203.0.113.42" or null
```

**Returns:** `Promise<string|null>` - IP address or null if failed

**How it works:**
1. Creates temporary RTCPeerConnection with Google STUN servers
2. Triggers ICE candidate gathering
3. Extracts public IP from srflx candidates
4. Filters out private/local IPs
5. Returns first public IP found

**Note:** May return local IP on some networks (NAT, VPN, corporate networks)

#### `getConnectionType()`

Gets the current connection type.

```javascript
const type = detector.getConnectionType();
console.log('Connection type:', type); // "wifi", "cellular", "4g", etc.
```

**Returns:** `string` - Connection type or 'unknown'

**Possible values:**
- Network types: `wifi`, `cellular`, `ethernet`, `bluetooth`, `wimax`, `other`, `unknown`
- Effective types: `slow-2g`, `2g`, `3g`, `4g`

#### `getStats()`

Gets comprehensive network statistics.

```javascript
const stats = detector.getStats();
console.log(stats);
```

**Returns:** Object with:

```javascript
{
  // Current state
  isOnline: true,
  currentConnectionType: "wifi",
  lastKnownIP: "203.0.113.42",

  // Connection details (if Network Info API available)
  connectionInfo: {
    effectiveType: "4g",
    type: "wifi",
    downlink: 10,      // Mbps
    rtt: 50,           // ms
    saveData: false
  },

  // Event counters
  ipChangeCount: 3,
  connectionTypeChangeCount: 2,
  onlineCount: 5,
  offlineCount: 4,

  // Timestamps
  lastIpChangeTime: 1699564800000,
  lastOnlineTime: 1699564850000,
  lastOfflineTime: 1699564700000,
  startTime: 1699560000000,

  // Durations (milliseconds)
  totalUptime: 4800000,
  currentOnlineDuration: 150000,
  currentOfflineDuration: 0,

  // Feature availability
  features: {
    networkInfo: true,
    webRTC: true,
    onlineAPI: true
  }
}
```

#### `getStatusSummary()`

Gets a human-readable status summary.

```javascript
const summary = detector.getStatusSummary();
console.log(summary);
```

**Returns:** String with formatted status

**Example output:**
```
Network Status: 🟢 ONLINE
Connection Type: wifi
Public IP: 203.0.113.42
IP Changes: 3
Connection Changes: 2
Uptime: 4800s
```

#### `destroy()`

Stops monitoring and cleans up resources.

```javascript
detector.destroy();
```

**Actions:**
- Clears periodic IP check interval
- Removes all event listeners
- Clears pending timeouts

## How IP Detection Works

### STUN-Based IP Detection

The detector uses WebRTC's ICE (Interactive Connectivity Establishment) process to discover the public IP:

```javascript
// 1. Create temporary peer connection with STUN server
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
});

// 2. Trigger ICE gathering
pc.createDataChannel('');
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

// 3. Wait for ICE candidates
pc.onicecandidate = (event) => {
  // Extract IP from srflx (server reflexive) candidates
  const ip = extractIPFromCandidate(event.candidate);
};
```

**Why STUN?**
- Standard WebRTC protocol
- Works with all modern browsers
- Free public STUN servers available
- Discovers actual public IP (what peers see)

**Limitations:**
- May return local IP on restrictive networks
- Requires working WebRTC stack
- Depends on STUN server availability
- Takes 1-5 seconds to complete

### IP Change Detection Flow

```
1. Periodic Check (every 2 minutes)
   ↓
2. Get current public IP via STUN
   ↓
3. Compare with stored IP (localStorage)
   ↓
4. If different:
   - Update stored IP
   - Increment change counter
   - Call reconnector.handleIpChange()
   ↓
5. Mesh announcement sent to all peers
```

## Network Change Events

### Connection Type Change

Triggered by Network Information API when connection type changes:

```
WiFi → Cellular
  ↓
handleNetworkChange()
  ↓
Wait 2 seconds (stabilization)
  ↓
Check IP via STUN
  ↓
Announce if changed
```

### Online/Offline Transitions

Triggered by browser online/offline events:

```
Offline → Online
  ↓
handleOnline()
  ↓
Calculate offline duration
  ↓
Wait 2 seconds (stabilization)
  ↓
Check IP via STUN
  ↓
Announce if changed
```

## Configuration

### Timing Constants

You can modify these by editing the class:

```javascript
// Periodic IP check interval
this.ipCheckInterval = setInterval(() => {
  this.checkPublicIP();
}, 120000); // 2 minutes (configurable)

// Network stabilization delay
await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds

// Debounce rapid changes
setTimeout(() => {
  this.handleNetworkChange();
}, 1000); // 1 second
```

### STUN Servers

Default servers (Google public STUN):
```javascript
iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]
```

**Alternative STUN servers:**
- Mozilla: `stun:stun.services.mozilla.com`
- Twilio: `stun:global.stun.twilio.com:3478`
- Custom: `stun:your-server.com:3478`

## Common Use Cases

### 1. Detect WiFi → Cellular Switch

```javascript
// Automatically detected when Network Information API available
detector.initialize();

// Monitor connection type changes
const stats = detector.getStats();
console.log('Changes:', stats.connectionTypeChangeCount);
```

### 2. Detect VPN Toggle

```javascript
// VPN changes typically change public IP
detector.initialize();

// IP changes are automatically detected and announced
```

### 3. Detect Network Reconnection

```javascript
// Offline → Online transitions trigger IP checks
detector.initialize();

// Check reconnection stats
const stats = detector.getStats();
console.log('Offline events:', stats.offlineCount);
console.log('Online events:', stats.onlineCount);
```

### 4. Manual IP Check

```javascript
// Force an immediate IP check
const ip = await detector.getPublicIP();
console.log('Current IP:', ip);

// Or trigger full check with announcement
await detector.checkPublicIP();
```

## Debugging

### Enable Debug Logging

All network events are logged with `[NetworkDetector]` prefix:

```
[NetworkDetector] Initialized with features: { networkInfo: true, webRTC: true, onLine: true }
[NetworkDetector] Starting network change monitoring...
[NetworkDetector] Initial connection type: wifi
[NetworkDetector] Listening for connection changes
[NetworkDetector] Checking public IP...
[NetworkDetector] Current IP: 203.0.113.42
[NetworkDetector] IP unchanged: 203.0.113.42
```

### Check Status Anytime

```javascript
// Quick status check
console.log(detector.getStatusSummary());

// Detailed statistics
console.log(detector.getStats());

// Current connection info
console.log('Online:', navigator.onLine);
console.log('Type:', detector.getConnectionType());
```

### Test IP Change Detection

```javascript
// Simulate IP change for testing
localStorage.setItem('lastKnownPublicIP', '203.0.113.1');
await detector.checkPublicIP(); // Will detect change
```

### Monitor All Events

```javascript
// Log all network state changes
setInterval(() => {
  console.log('Network:', {
    online: navigator.onLine,
    type: detector.getConnectionType(),
    ip: localStorage.getItem('lastKnownPublicIP'),
    changes: detector.ipChangeCount
  });
}, 5000);
```

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge | Opera |
|---------|--------|---------|--------|------|-------|
| Online/Offline Events | ✅ | ✅ | ✅ | ✅ | ✅ |
| Network Information API | ✅ | ❌ | ❌ | ✅ | ✅ |
| WebRTC/STUN | ✅ | ✅ | ✅ | ✅ | ✅ |

**Notes:**
- Firefox/Safari: No Network Information API, returns 'unknown' for connection type
- All browsers: Online/offline detection and IP detection work
- iOS Safari: WebRTC may be restricted in some contexts

## Error Handling

The detector handles errors gracefully:

```javascript
// Missing APIs
if (!navigator.connection) {
  // Falls back to 'unknown' connection type
}

if (!window.RTCPeerConnection) {
  // Disables IP detection
  // Still monitors online/offline
}

// STUN failures
try {
  const ip = await getPublicIP();
} catch (error) {
  // Returns null, logs error
  // Doesn't break monitoring
}

// Reconnector failures
try {
  await reconnector.handleIpChange();
} catch (error) {
  // Logs error, continues monitoring
}
```

## Performance Considerations

### Network Usage

- **Periodic checks**: ~1 KB every 2 minutes (STUN request)
- **Event-driven checks**: Only when network changes
- **Minimal overhead**: STUN connection closed immediately

### CPU Usage

- **Idle**: Negligible (only event listeners)
- **During check**: Brief spike for WebRTC connection
- **Memory**: < 1 MB

### Battery Impact

- **Minimal**: Periodic checks are infrequent
- **Event-driven**: Only checks when needed
- **Optimized**: 2-second stabilization delays prevent excessive checks

## Testing

Run the test suite:

```bash
npm test src/network/change-detector.test.js
```

**Test coverage:**
- ✅ Initialization and setup
- ✅ Connection type detection
- ✅ Online/offline handling
- ✅ IP change detection
- ✅ Statistics tracking
- ✅ Cleanup and resource management
- ✅ Error handling
- ✅ Browser API compatibility

## Integration Examples

See these files for integration patterns:

- **[integration-example.js](./integration-example.js)** - Complete setup with mesh network
- **[change-detector.test.js](./change-detector.test.js)** - Unit tests and usage patterns

## Troubleshooting

### "Could not determine public IP"

**Causes:**
- Restrictive firewall blocking STUN
- WebRTC disabled in browser
- STUN servers unreachable
- Network in restrictive mode (corporate, VPN)

**Solutions:**
- Check browser WebRTC settings
- Try different STUN servers
- Check firewall/network policies
- Enable WebRTC in browser settings

### "IP change not detected"

**Causes:**
- Still on same network (IP unchanged)
- STUN returning cached result
- Network using NAT (same public IP)

**Solutions:**
- Wait for periodic check (2 minutes)
- Manually trigger: `await detector.checkPublicIP()`
- Check actual IP: `await detector.getPublicIP()`

### "Network Information API not available"

**Causes:**
- Browser doesn't support it (Firefox, Safari)
- Feature disabled

**Solutions:**
- This is normal, detector still works
- Connection type will be 'unknown'
- IP detection still works
- Online/offline detection still works

### High frequency of IP checks

**Causes:**
- Unstable network triggering many change events
- Rapid connection type changes

**Solutions:**
- Debouncing is built-in (1 second)
- Stabilization delays prevent excess checks
- Consider increasing debounce time

## Advanced Usage

### Custom Reconnector

```javascript
class CustomReconnector {
  async handleIpChange() {
    console.log('IP changed! Custom logic here...');

    // Your custom reconnection logic
    await this.customReconnectMethod();

    // Announce to mesh
    await this.announcementManager.announceIpChange();
  }
}

const detector = new NetworkChangeDetector(new CustomReconnector());
```

### Multiple Listeners

```javascript
// Original reconnector
const primaryReconnector = {
  async handleIpChange() {
    await announcementManager.announceIpChange();
  }
};

// Wrapper with multiple actions
const multiReconnector = {
  async handleIpChange() {
    // Primary action
    await primaryReconnector.handleIpChange();

    // Additional actions
    await this.logToAnalytics();
    await this.notifyUI();
    await this.refreshConnections();
  }
};

const detector = new NetworkChangeDetector(multiReconnector);
```

### Conditional IP Checks

```javascript
// Only check IP during certain hours
const smartReconnector = {
  async handleIpChange() {
    const hour = new Date().getHours();

    // Only announce during active hours
    if (hour >= 8 && hour <= 22) {
      await announcementManager.announceIpChange();
    } else {
      console.log('Off-hours, skipping announcement');
    }
  }
};
```

## License

Part of the serverless-chat project.

## See Also

- [MeshAnnouncementManager](../reconnection/mesh-announcements.js) - Mesh network announcements
- [DirectReconnection](../reconnection/direct-reconnection.js) - Direct peer reconnection
- [RelayReconnection](../reconnection/relay-reconnection.js) - Relay-based reconnection
