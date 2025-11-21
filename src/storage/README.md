# Peer Persistence Storage System

A comprehensive localStorage-based persistence layer for P2P mesh chat applications, enabling automatic reconnection after page refresh, IP address changes, and network interruptions.

## Quick Start

### Installation

```javascript
import peerPersistence from './storage/peer-persistence.js';
```

### Basic Usage

```javascript
// 1. Initialize on app startup
await peerPersistence.initialize();

// 2. Store peer after connection
import { createPeerData } from './storage/peer-persistence.js';

const peerData = createPeerData({
  peerId: 'ABC123',
  displayName: 'Alice',
  publicKey: JSON.stringify(publicKeyJWK),
  sharedSecret: 'secret-key',
  iceServers: ICE_CONFIG.iceServers,
});

await peerPersistence.storePeer(peerData);

// 3. Retrieve peer
const peer = await peerPersistence.getPeer('ABC123');

// 4. Get reconnection candidates
const candidates = await peerPersistence.getReconnectionCandidates({
  limit: 5,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
});

// 5. Attempt reconnection
for (const candidate of candidates) {
  await attemptReconnection(candidate.peer);
}
```

## Files

| File | Purpose |
|------|---------|
| `peer-persistence.js` | Main implementation |
| `peer-persistence.d.ts` | TypeScript definitions |
| `peer-persistence-examples.js` | Usage examples |
| `peer-persistence.test.js` | Test suite |
| `../docs/peer-persistence-guide.md` | Comprehensive documentation |

## Features

✅ **Encrypted Storage**
- AES-GCM encryption for sensitive data
- Web Crypto API integration
- Secure key management

✅ **Automatic Reconnection**
- Smart peer selection algorithm
- Connection quality scoring
- Blacklist management

✅ **Storage Management**
- Configurable peer limits
- Multiple cleanup strategies
- Quota management

✅ **Query System**
- Sort by recency, quality, or connection time
- Filter by age, quality score, blacklist status
- Efficient pagination

✅ **Data Integrity**
- Schema versioning
- Migration support
- Validation and error recovery

## Storage Schema

### Keys Organization

```
localStorage:
├── mesh:peers:index          # Array of peer IDs
├── mesh:peer:{peerId}        # Individual peer data
├── mesh:peers:metadata       # Global statistics
├── mesh:encryption:key       # AES-GCM master key
└── mesh:schema:version       # Schema version
```

### Peer Data Structure

```typescript
{
  peerId: string;              // Unique identifier
  displayName: string;         // Display name
  publicKey: string;           // JWK format
  encryptedSecret: string;     // Encrypted shared secret
  lastSeen: number;            // Timestamp
  lastConnected: number;       // Timestamp
  iceServers: RTCIceServer[];  // ICE configuration
  cachedCandidates: Array;     // Cached ICE candidates
  connectionQuality: {
    latency: number;
    successRate: number;
    connectionType: string;
    avgUptime: number;
  };
  reconnectionAttempts: number;
  blacklistUntil: number | null;
}
```

## Size Estimates

| Peers | Storage Size | localStorage % |
|-------|-------------|----------------|
| 20    | ~27 KB      | 0.5%          |
| 50    | ~67 KB      | 1.3%          |
| 100   | ~133 KB     | 2.7%          |

**Average per peer:** ~1.33 KB

## API Reference

### Initialization

```javascript
await peerPersistence.initialize();
```

### CRUD Operations

```javascript
// Store peer
await peerPersistence.storePeer(peerData);

// Get peer
const peer = await peerPersistence.getPeer(peerId);

// Remove peer
await peerPersistence.removePeer(peerId);

// Update last seen
await peerPersistence.updateLastSeen(peerId);

// Update connection quality
await peerPersistence.updateConnectionQuality(peerId, {
  latency: 100,
  connectionType: 'host',
});

// Increment failed attempts
await peerPersistence.incrementReconnectionAttempts(peerId);
```

### Query Operations

```javascript
// Get all peer IDs
const peerIds = await peerPersistence.getAllPeerIds();

// Query with filters
const peers = await peerPersistence.queryPeers({
  sortBy: 'lastSeen',    // or 'quality', 'lastConnected'
  order: 'desc',         // or 'asc'
  limit: 10,             // Max results
  minQuality: 50,        // Minimum quality score
  maxAge: 7 * 24 * 60 * 60 * 1000,  // Max age in ms
  excludeBlacklisted: true,
});

// Get reconnection candidates
const candidates = await peerPersistence.getReconnectionCandidates({
  limit: 10,
  maxAge: 24 * 60 * 60 * 1000,
});
```

### Cleanup Operations

```javascript
// Cleanup stale peers
const removed = await peerPersistence.cleanupStalePeers();

// LRU cleanup
await peerPersistence.cleanupLRU(50); // Keep top 50

// Clear expired blacklists
await peerPersistence.clearExpiredBlacklists();
```

### Storage Management

```javascript
// Get storage statistics
const stats = await peerPersistence.getStorageStats();
// {
//   peerCount: 42,
//   estimatedSizeBytes: 56000,
//   estimatedSizeMB: "0.05",
//   utilizationPercent: "42.0"
// }

// Check if cleanup needed
const needsCleanup = await peerPersistence.needsCleanup();

// Export data (backup)
const exportData = await peerPersistence.exportData();

// Import data (restore)
await peerPersistence.importData(exportData);

// Clear all data (logout)
await peerPersistence.clearAll();
```

## Common Use Cases

### 1. Page Refresh Reconnection

```javascript
window.addEventListener('load', async () => {
  await peerPersistence.initialize();

  const candidates = await peerPersistence.getReconnectionCandidates({
    limit: 5,
    maxAge: 24 * 60 * 60 * 1000,
  });

  for (const candidate of candidates) {
    const success = await attemptReconnection(candidate.peer);

    if (success) {
      await peerPersistence.updateLastSeen(candidate.peer.peerId);
    } else {
      await peerPersistence.incrementReconnectionAttempts(
        candidate.peer.peerId
      );
    }
  }
});
```

### 2. IP Address Change Handling

```javascript
peerManager.on('message', async (peerId, message) => {
  if (message.type === 'ip-change') {
    const peer = await peerPersistence.getPeer(peerId);

    peer.cachedCandidates = message.newCandidates;
    peer.lastKnownIP = message.newIP;

    await peerPersistence.storePeer(peer);
    await attemptReconnection(peer);
  }
});
```

### 3. Periodic Maintenance

```javascript
setInterval(async () => {
  if (await peerPersistence.needsCleanup()) {
    const removed = await peerPersistence.cleanupStalePeers();
    console.log(`Cleaned up ${removed} stale peers`);
  }
}, 6 * 60 * 60 * 1000); // Every 6 hours
```

### 4. Connection Quality Tracking

```javascript
peerManager.on('latency', async (peerId, latency) => {
  await peerPersistence.updateConnectionQuality(peerId, { latency });
});

peerManager.on('disconnect', async (peerId, uptime) => {
  const peer = await peerPersistence.getPeer(peerId);
  const updatedQuality = updateQualityMetrics(
    peer.connectionQuality,
    { uptime, success: true }
  );
  await peerPersistence.updateConnectionQuality(peerId, updatedQuality);
});
```

### 5. Smart Peer Selection for Routing

```javascript
// Get high-quality peers for message routing
const routingPeers = await peerPersistence.queryPeers({
  sortBy: 'quality',
  order: 'desc',
  limit: 5,
  minQuality: 70,
  maxAge: 24 * 60 * 60 * 1000,
});

// Route message through best peer
if (routingPeers.length > 0) {
  await routeMessage(message, routingPeers[0]);
}
```

## Configuration

Edit `STORAGE_CONFIG` in `peer-persistence.js`:

```javascript
export const STORAGE_CONFIG = {
  MAX_PEERS: 100,              // Maximum peers to store
  MAX_STORAGE_MB: 5,           // Target max storage
  CLEANUP_THRESHOLD: 0.8,      // Trigger cleanup at 80%

  RETENTION: {
    ACTIVE_DAYS: 7,            // Keep peers seen in last 7 days
    INACTIVE_DAYS: 30,         // Remove after 30 days inactive
    FAILED_ATTEMPTS: 5,        // Max failed reconnections
    BLACKLIST_DURATION: 24 * 60 * 60 * 1000,  // 24 hours
  },
};
```

## Testing

```javascript
import { runAllTests } from './peer-persistence.test.js';

// Run all tests
const results = await runAllTests();
console.log(`${results.passed} passed, ${results.failed} failed`);
```

Or in browser:
```
http://localhost:3000/?run-tests
```

## Security Best Practices

1. **Always encrypt sensitive data:**
   ```javascript
   // Shared secrets are automatically encrypted
   peerData.sharedSecret = 'secret'; // Will be encrypted at rest
   ```

2. **Clear data on logout:**
   ```javascript
   await peerPersistence.clearAll();
   ```

3. **Validate all input:**
   ```javascript
   function validatePeerData(peer) {
     if (!peer.peerId || typeof peer.peerId !== 'string') {
       throw new Error('Invalid peer data');
     }
   }
   ```

4. **Use Content Security Policy:**
   ```html
   <meta http-equiv="Content-Security-Policy"
         content="default-src 'self'; script-src 'self';">
   ```

5. **Sanitize display names:**
   ```javascript
   displayName = displayName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
   ```

## Troubleshooting

### QuotaExceededError

```javascript
try {
  await peerPersistence.storePeer(peer);
} catch (e) {
  if (e.name === 'QuotaExceededError') {
    await peerPersistence.cleanupLRU(50);
    await peerPersistence.storePeer(peer); // Retry
  }
}
```

### Corrupted Data

```javascript
const peer = await peerPersistence.getPeer(peerId);
if (!peer || !peer.peerId) {
  // Remove corrupted peer
  await peerPersistence.removePeer(peerId);
}
```

### Slow Queries

```javascript
// Use limits
const peers = await peerPersistence.queryPeers({ limit: 20 });

// Cache results
let cachedPeers = null;
let cacheTime = 0;

async function getCachedPeers() {
  if (cachedPeers && Date.now() - cacheTime < 5 * 60 * 1000) {
    return cachedPeers;
  }
  cachedPeers = await peerPersistence.queryPeers();
  cacheTime = Date.now();
  return cachedPeers;
}
```

## Performance Tips

1. **Batch operations:**
   ```javascript
   await Promise.all(peers.map(p => peerPersistence.storePeer(p)));
   ```

2. **Lazy load:**
   ```javascript
   const peerIds = await peerPersistence.getAllPeerIds();
   // Only load full data when needed
   const peer = await peerPersistence.getPeer(selectedId);
   ```

3. **Debounce updates:**
   ```javascript
   const debouncedUpdate = debounce(
     (peerId) => peerPersistence.updateLastSeen(peerId),
     5000
   );
   ```

## Documentation

- **Quick Start:** This file
- **Complete Guide:** `../docs/peer-persistence-guide.md`
- **Examples:** `peer-persistence-examples.js`
- **Tests:** `peer-persistence.test.js`
- **TypeScript:** `peer-persistence.d.ts`

## License

Part of the Serverless Chat application.

## Support

For issues or questions, see the comprehensive guide at:
`docs/peer-persistence-guide.md`
