# Network Change Detector - Quick Start Guide

## 5-Minute Setup

### 1. Import and Initialize

```javascript
import NetworkChangeDetector from './network/change-detector.js';

// Your announcement manager (already set up)
import announcementManager from './your-setup.js';

// Create adapter
const reconnectorAdapter = {
  async handleIpChange() {
    return await announcementManager.announceIpChange();
  }
};

// Create and start detector
const networkDetector = new NetworkChangeDetector(reconnectorAdapter);
networkDetector.initialize();
```

### 2. Clean Up on Exit

```javascript
window.addEventListener('beforeunload', () => {
  networkDetector.destroy();
});
```

That's it! The detector is now monitoring network changes.

---

## What It Does Automatically

✅ **Monitors IP changes** - Checks every 2 minutes via STUN
✅ **Monitors connection type** - Detects WiFi ↔ Cellular switches
✅ **Monitors online/offline** - Tracks connectivity status
✅ **Announces IP changes** - Calls your reconnector when IP changes

---

## Common Operations

### Check Current Status

```javascript
// Quick summary
console.log(networkDetector.getStatusSummary());

// Detailed stats
const stats = networkDetector.getStats();
console.log('IP changes:', stats.ipChangeCount);
console.log('Current IP:', stats.lastKnownIP);
console.log('Connection:', stats.currentConnectionType);
```

### Force IP Check

```javascript
// Check IP immediately (doesn't wait for periodic check)
await networkDetector.checkPublicIP();
```

### Get Current IP

```javascript
const ip = await networkDetector.getPublicIP();
console.log('Public IP:', ip); // "203.0.113.42" or null
```

---

## Debugging

### Enable in Browser Console

```javascript
// Make detector accessible
window.networkDetector = networkDetector;

// Check status anytime
window.networkDetector.getStatusSummary();
window.networkDetector.getStats();
```

### Watch Events

All events are logged with `[NetworkDetector]` prefix:

```
[NetworkDetector] Initialized with features: { ... }
[NetworkDetector] Checking public IP...
[NetworkDetector] Current IP: 203.0.113.42
[NetworkDetector] 🔄 IP CHANGED: 203.0.113.42 → 203.0.113.99
```

### Test IP Change

```javascript
// Simulate IP change for testing
localStorage.setItem('lastKnownPublicIP', '203.0.113.1');
await networkDetector.checkPublicIP(); // Will detect change
```

---

## Configuration

### Change Check Interval

Edit the initialization in `change-detector.js`:

```javascript
// Default: 120000 (2 minutes)
this.ipCheckInterval = setInterval(() => {
  this.checkPublicIP();
}, 300000); // 5 minutes
```

### Change STUN Servers

Edit `getPublicIP()` in `change-detector.js`:

```javascript
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:your-server.com:3478' }
  ]
});
```

---

## Troubleshooting

### "Could not determine public IP"

**Likely causes:**
- WebRTC blocked by browser/extension
- STUN servers unreachable
- Restrictive network/firewall

**Fix:** Check browser settings, try different STUN servers

### IP changes not detected

**Likely causes:**
- Still on same network (IP actually unchanged)
- NAT keeping same public IP

**Fix:** Manually check: `await networkDetector.getPublicIP()`

### High CPU usage

**Likely causes:**
- Rapid network changes triggering many checks

**Fix:** System has built-in debouncing, but you can increase delays

---

## Integration Patterns

### With Mesh Network

```javascript
import MeshAnnouncementManager from './reconnection/mesh-announcements.js';

const announcementManager = new MeshAnnouncementManager(...);
const reconnector = {
  async handleIpChange() {
    await announcementManager.announceIpChange();
  }
};

const detector = new NetworkChangeDetector(reconnector);
detector.initialize();
```

### With Custom Logic

```javascript
const reconnector = {
  async handleIpChange() {
    console.log('IP changed! Running custom logic...');

    // Your custom code here
    await this.updateConnections();
    await this.notifyServer();
    await this.refreshUI();
  }
};

const detector = new NetworkChangeDetector(reconnector);
detector.initialize();
```

### With Multiple Actions

```javascript
const reconnector = {
  async handleIpChange() {
    // Run multiple actions on IP change
    await Promise.all([
      announcementManager.announceIpChange(),
      analytics.track('ip_changed'),
      ui.showNotification('Network changed')
    ]);
  }
};
```

---

## Browser Support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| IP Detection | ✅ | ✅ | ✅ | ✅ |
| Online/Offline | ✅ | ✅ | ✅ | ✅ |
| Connection Type | ✅ | ❌ | ❌ | ✅ |

**Note:** Firefox/Safari don't support Network Information API, so `getConnectionType()` returns `'unknown'`. Everything else works fine.

---

## Statistics Tracking

```javascript
const stats = detector.getStats();

console.log({
  // Current state
  isOnline: stats.isOnline,
  connectionType: stats.currentConnectionType,
  lastKnownIP: stats.lastKnownIP,

  // Event counts
  ipChanges: stats.ipChangeCount,
  connectionChanges: stats.connectionTypeChangeCount,
  onlineEvents: stats.onlineCount,
  offlineEvents: stats.offlineCount,

  // Timing
  lastIpChange: new Date(stats.lastIpChangeTime),
  uptime: stats.totalUptime / 1000 + ' seconds',

  // Features
  hasNetworkInfo: stats.features.networkInfo,
  hasWebRTC: stats.features.webRTC
});
```

---

## Performance

- **Memory:** ~1 KB per instance
- **Network:** ~700 bytes per check (every 2 minutes)
- **CPU:** <0.1% idle, ~1-5% during checks
- **Battery:** Minimal impact (infrequent checks)

---

## Next Steps

📖 **[Full Documentation](./README.md)** - Complete API reference
🏗️ **[Architecture Guide](./ARCHITECTURE.md)** - System design and diagrams
🧪 **[Test Suite](./change-detector.test.js)** - Unit tests and examples
💡 **[Integration Examples](./integration-example.js)** - Advanced patterns

---

## Need Help?

1. Check the logs (`[NetworkDetector]` prefix)
2. Use `getStats()` to see current state
3. Test manually with `getPublicIP()`
4. Check browser compatibility
5. Verify reconnector is working

---

## Common Mistakes

❌ **Forgetting to initialize**
```javascript
const detector = new NetworkChangeDetector(reconnector);
// Missing: detector.initialize();
```

✅ **Correct:**
```javascript
const detector = new NetworkChangeDetector(reconnector);
detector.initialize(); // Don't forget!
```

---

❌ **Not cleaning up**
```javascript
// Memory leak - listeners never removed
```

✅ **Correct:**
```javascript
window.addEventListener('beforeunload', () => {
  detector.destroy();
});
```

---

❌ **Missing handleIpChange method**
```javascript
const reconnector = {};
const detector = new NetworkChangeDetector(reconnector);
// Will warn about missing method
```

✅ **Correct:**
```javascript
const reconnector = {
  async handleIpChange() {
    await announcementManager.announceIpChange();
  }
};
```

---

## Quick Reference

```javascript
// Create
const detector = new NetworkChangeDetector(reconnector);

// Start
detector.initialize();

// Check status
detector.getStatusSummary();
detector.getStats();

// Manual check
await detector.getPublicIP();
await detector.checkPublicIP();

// Connection info
detector.getConnectionType();

// Stop
detector.destroy();
```

---

That's all you need to get started! 🚀
