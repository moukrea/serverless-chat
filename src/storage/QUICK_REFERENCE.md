# Peer Persistence - Quick Reference Card

## Installation & Initialization

```javascript
import peerPersistence, { createPeerData } from './storage/peer-persistence.js';

// Initialize once on app startup
await peerPersistence.initialize();
```

## Store Peer (On Connection)

```javascript
const peerData = createPeerData({
  peerId: 'ABC123',
  displayName: 'Alice',
  publicKey: JSON.stringify(publicKeyJWK),
  sharedSecret: 'secret-key',      // Automatically encrypted
  iceServers: ICE_CONFIG.iceServers,
  cachedCandidates: iceCandidates,
});

await peerPersistence.storePeer(peerData);
```

## Automatic Reconnection (On Page Refresh)

```javascript
const candidates = await peerPersistence.getReconnectionCandidates({
  limit: 5,
  maxAge: 24 * 60 * 60 * 1000,  // 24 hours
});

for (const candidate of candidates) {
  const peer = candidate.peer;
  const success = await reconnect(peer.peerId, {
    iceServers: peer.iceServers,
    cachedCandidates: peer.cachedCandidates,
  });

  if (success) {
    await peerPersistence.updateLastSeen(peer.peerId);
  } else {
    await peerPersistence.incrementReconnectionAttempts(peer.peerId);
  }
}
```

## Update Connection Quality

```javascript
// During connection
peerManager.on('latency', async (peerId, latency, connectionType) => {
  await peerPersistence.updateConnectionQuality(peerId, {
    latency,
    connectionType,
  });
});

// On disconnect
import { updateQualityMetrics } from './storage/peer-persistence.js';

peerManager.on('disconnect', async (peerId, uptime) => {
  const peer = await peerPersistence.getPeer(peerId);
  const quality = updateQualityMetrics(peer.connectionQuality, {
    uptime,
    success: true,
  });
  await peerPersistence.updateConnectionQuality(peerId, quality);
});
```

## Query Peers

```javascript
// Recently active peers
const recent = await peerPersistence.queryPeers({
  sortBy: 'lastSeen',
  order: 'desc',
  limit: 10,
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

// High-quality peers (for routing)
const quality = await peerPersistence.queryPeers({
  sortBy: 'quality',
  order: 'desc',
  limit: 5,
  minQuality: 70,
});

// Authenticated peers
const all = await peerPersistence.queryPeers();
const authenticated = all.filter(p => p.sharedSecret);
```

## Handle IP Address Changes

```javascript
peerManager.on('message', async (peerId, message) => {
  if (message.type === 'ip-change') {
    const peer = await peerPersistence.getPeer(peerId);

    peer.cachedCandidates = message.newCandidates;
    peer.lastKnownIP = message.newIP;
    peer.lastSeen = Date.now();

    await peerPersistence.storePeer(peer);
    await reconnect(peer);
  }
});
```

## Periodic Cleanup

```javascript
// Run every 6 hours
setInterval(async () => {
  if (await peerPersistence.needsCleanup()) {
    const removed = await peerPersistence.cleanupStalePeers();
    console.log(`Cleaned up ${removed} stale peers`);
  }
}, 6 * 60 * 60 * 1000);
```

## Storage Statistics

```javascript
const stats = await peerPersistence.getStorageStats();
console.log({
  peers: stats.peerCount,
  size: stats.estimatedSizeMB + ' MB',
  utilization: stats.utilizationPercent + '%',
});
```

## Backup/Restore

```javascript
// Export (backup)
const backup = await peerPersistence.exportData();
localStorage.setItem('peer-backup', JSON.stringify(backup));

// Import (restore)
const backup = JSON.parse(localStorage.getItem('peer-backup'));
await peerPersistence.importData(backup);
```

## Logout/Clear Data

```javascript
// Clear all peer data
await peerPersistence.clearAll();
```

## Error Handling

```javascript
// Quota exceeded
try {
  await peerPersistence.storePeer(peer);
} catch (e) {
  if (e.name === 'QuotaExceededError') {
    await peerPersistence.cleanupLRU(50);
    await peerPersistence.storePeer(peer);
  }
}

// Corrupted data
const peer = await peerPersistence.getPeer(peerId);
if (!peer || !peer.peerId) {
  await peerPersistence.removePeer(peerId);
}
```

## Configuration

```javascript
// In peer-persistence.js
export const STORAGE_CONFIG = {
  MAX_PEERS: 100,
  RETENTION: {
    INACTIVE_DAYS: 30,
    FAILED_ATTEMPTS: 5,
    BLACKLIST_DURATION: 24 * 60 * 60 * 1000,
  },
};
```

## Key Methods

| Method | Purpose |
|--------|---------|
| `initialize()` | Initialize storage system |
| `storePeer(data)` | Store/update peer |
| `getPeer(id)` | Get peer by ID |
| `removePeer(id)` | Remove peer |
| `queryPeers(opts)` | Query with filters |
| `getReconnectionCandidates(opts)` | Get reconnection targets |
| `updateConnectionQuality(id, quality)` | Update metrics |
| `cleanupStalePeers()` | Remove old peers |
| `getStorageStats()` | Get statistics |
| `clearAll()` | Clear all data |

## Data Structure

```typescript
interface PeerData {
  peerId: string;
  displayName: string;
  publicKey: string;
  encryptedSecret: string;      // Encrypted at rest
  lastSeen: number;
  lastConnected: number;
  iceServers: RTCIceServer[];
  cachedCandidates: Array;
  connectionQuality: {
    latency: number;
    successRate: number;
    connectionType: 'host' | 'srflx' | 'relay';
    totalConnections: number;
    successfulConnections: number;
    avgUptime: number;
  };
  reconnectionAttempts: number;
  blacklistUntil: number | null;
}
```

## Storage Keys

```
mesh:peers:index          # Array of peer IDs
mesh:peer:{peerId}        # Individual peer data
mesh:peers:metadata       # Global statistics
mesh:encryption:key       # AES-GCM master key
mesh:schema:version       # Schema version
```

## Size Estimates

- **Per peer:** ~1.33 KB
- **100 peers:** ~133 KB (2.7% of 5MB)
- **Comfortable limit:** 50 peers (~67 KB)

## Quality Scoring (0-100)

- **Latency (40%):** <50ms = 40pts, <100ms = 35pts, <200ms = 25pts
- **Success Rate (30%):** 90% = 27pts, 80% = 24pts, 70% = 21pts
- **Connection Type (20%):** host = 20pts, srflx = 12pts, relay = 5pts
- **Uptime (10%):** >10min = 10pts, >5min = 7pts, >1min = 4pts

## Reconnection Scoring (0-100)

- **Quality (40%):** Base score from connection quality
- **Recency (30%):** <1 day = 30pts, <3 days = 20pts, <7 days = 10pts
- **Success (20%):** Bonus for successful connections
- **Reliability (10%):** Low failure rate bonus
- **Penalty:** -5pts per failed attempt

## Security Checklist

- ✅ Shared secrets encrypted with AES-GCM
- ✅ Master key stored separately
- ✅ Input validation on all operations
- ✅ Display names sanitized
- ✅ Clear data on logout
- ✅ No sensitive data in logs

## Testing

```javascript
import { runAllTests } from './peer-persistence.test.js';
await runAllTests();
```

## Full Documentation

- **Complete Guide:** `../docs/peer-persistence-guide.md`
- **Examples:** `peer-persistence-examples.js`
- **Tests:** `peer-persistence.test.js`
- **API Docs:** `README.md`
