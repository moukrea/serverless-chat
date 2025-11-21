# Peer Persistence System - Comprehensive Guide

## Overview

The peer persistence system enables automatic reconnection in a P2P mesh chat application by storing peer metadata in localStorage. This system handles reconnection after page refresh, IP address changes, and network interruptions without requiring a central server or DHT.

## Table of Contents

1. [Architecture](#architecture)
2. [Storage Schema](#storage-schema)
3. [Size Estimates](#size-estimates)
4. [Security Considerations](#security-considerations)
5. [Query Patterns](#query-patterns)
6. [Cleanup Strategies](#cleanup-strategies)
7. [Integration Guide](#integration-guide)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Architecture

### Storage Organization

The system uses a hybrid approach combining an index and individual peer storage:

```
localStorage structure:
├── mesh:peers:index          → [peerId1, peerId2, ...] (Array of IDs)
├── mesh:peer:{peerId1}       → {...peer data...}
├── mesh:peer:{peerId2}       → {...peer data...}
├── mesh:peers:metadata       → {...global stats...}
├── mesh:encryption:key       → {...AES-GCM key...}
└── mesh:schema:version       → "1.0.0"
```

**Advantages:**
- Fast lookups by peer ID (O(1))
- Easy to remove individual peers
- Efficient iteration over all peers
- Simple to maintain index consistency

**Trade-offs:**
- Each peer requires 2 localStorage operations (index + data)
- Index must be kept in sync
- Multiple keys consume more space

---

## Storage Schema

### Complete Peer Data Structure

```typescript
interface PeerData {
  // Identity
  peerId: string;              // e.g., "ABC123" (6 chars)
  userId: string;              // User identifier
  displayName: string;         // Display name

  // Timestamps
  firstSeen: number;           // Unix timestamp (ms)
  lastSeen: number;            // Last activity timestamp
  lastConnected: number;       // Last successful connection

  // Cryptography
  publicKey: string;           // JWK format (JSON string, ~180 bytes)
  encryptedSecret: string;     // AES-GCM encrypted (base64, ~100 bytes)

  // Network Information
  lastKnownIP: string | null;  // IPv4/IPv6 address
  iceServers: RTCIceServer[];  // ICE server configuration
  cachedCandidates: Array<{    // Pre-discovered ICE candidates
    candidate: string;
    sdpMid: string;
    sdpMLineIndex: number;
    type: 'host' | 'srflx' | 'relay' | 'prflx';
  }>;

  // Connection Quality
  connectionQuality: {
    latency: number | null;           // Average latency (ms)
    successRate: number;              // 0.0 - 1.0
    connectionType: string | null;    // 'host', 'srflx', 'relay'
    lastMeasured: number;             // Timestamp
    totalConnections: number;         // Total attempts
    successfulConnections: number;    // Successful attempts
    avgUptime: number;                // Average uptime (seconds)
  };

  // Reconnection Management
  reconnectionAttempts: number;  // Failed attempts counter
  blacklistUntil: number | null; // Blacklist expiry timestamp

  // Metadata
  metadata: Record<string, any>; // Custom application data
  dataVersion: string;           // Schema version
}
```

### Storage Keys

| Key | Purpose | Size | Frequency |
|-----|---------|------|-----------|
| `mesh:peers:index` | Array of all peer IDs | ~600 bytes (100 peers) | Write on add/remove |
| `mesh:peer:{id}` | Individual peer data | ~1-2 KB per peer | Write on updates |
| `mesh:peers:metadata` | Global statistics | ~200 bytes | Write daily |
| `mesh:encryption:key` | Master encryption key | ~200 bytes | Write once |
| `mesh:schema:version` | Schema version | ~10 bytes | Write once |

---

## Size Estimates

### Per-Peer Storage Breakdown

```javascript
// Typical peer data size estimation
{
  peerId: 6 bytes,
  userId: 10 bytes,
  displayName: 20 bytes,
  firstSeen: 13 bytes,           // "1700000000000"
  lastSeen: 13 bytes,
  lastConnected: 13 bytes,
  publicKey: 180 bytes,          // JWK format
  encryptedSecret: 100 bytes,    // AES-GCM encrypted
  lastKnownIP: 15 bytes,         // IPv4 "255.255.255.255"
  iceServers: 150 bytes,         // 2-3 servers
  cachedCandidates: 500 bytes,   // 3-5 candidates
  connectionQuality: 80 bytes,   // All metrics
  reconnectionAttempts: 1 byte,
  blacklistUntil: 13 bytes,
  metadata: 50 bytes,            // Custom data
  dataVersion: 10 bytes,
  JSON overhead: ~200 bytes      // Brackets, quotes, etc.
}

Total per peer: ~1,364 bytes (~1.33 KB)
```

### Storage Capacity Planning

| Scenario | Peers | Size | localStorage % |
|----------|-------|------|----------------|
| Light | 20 | ~27 KB | 0.5% |
| Medium | 50 | ~67 KB | 1.3% |
| Heavy | 100 | ~133 KB | 2.7% |
| Maximum | 200 | ~266 KB | 5.3% |

**Assumptions:**
- localStorage capacity: 5 MB per origin (typical)
- Average peer size: 1.33 KB
- Index overhead: ~600 bytes per 100 peers
- Metadata: ~200 bytes

### Browser Storage Limits

| Browser | localStorage Limit | Notes |
|---------|-------------------|-------|
| Chrome | 10 MB | Per origin |
| Firefox | 10 MB | Per origin |
| Safari | 5 MB | May prompt user |
| Edge | 10 MB | Per origin |
| Mobile Safari | 5 MB | More restrictive |

**Recommendations:**
- Target maximum: 100 peers (133 KB)
- Comfortable limit: 50 peers (67 KB)
- Emergency cleanup threshold: 80 peers
- Always leave 90% localStorage free for other app data

---

## Security Considerations

### 1. Encryption at Rest

**What to Encrypt:**
- ✅ Shared secrets
- ✅ Private keys (if stored)
- ❌ Public keys (no need)
- ❌ Peer IDs (used for indexing)

**Encryption Implementation:**

```javascript
// Using Web Crypto API with AES-GCM
async function encryptSharedSecret(secret) {
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(secret);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // Combine IV + ciphertext for storage
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}
```

**Key Management:**

1. **Master Key Generation:**
   ```javascript
   const masterKey = await crypto.subtle.generateKey(
     { name: 'AES-GCM', length: 256 },
     true,
     ['encrypt', 'decrypt']
   );
   ```

2. **Key Storage Options:**
   - Store in localStorage (encrypted with session key)
   - Derive from user password (PBKDF2)
   - Store in memory only (regenerate per session)

3. **Recommended Approach:**
   ```javascript
   // Derive key from user session
   async function deriveKeyFromSession(sessionToken) {
     const keyMaterial = await crypto.subtle.importKey(
       'raw',
       new TextEncoder().encode(sessionToken),
       'PBKDF2',
       false,
       ['deriveKey']
     );

     return crypto.subtle.deriveKey(
       {
         name: 'PBKDF2',
         salt: new TextEncoder().encode('mesh-p2p-salt'),
         iterations: 100000,
         hash: 'SHA-256',
       },
       keyMaterial,
       { name: 'AES-GCM', length: 256 },
       true,
       ['encrypt', 'decrypt']
     );
   }
   ```

### 2. XSS Protection

**Threat:** Malicious scripts reading localStorage

**Mitigations:**

1. **Content Security Policy (CSP):**
   ```html
   <meta http-equiv="Content-Security-Policy"
         content="default-src 'self'; script-src 'self'; object-src 'none';">
   ```

2. **Input Sanitization:**
   ```javascript
   function sanitizeDisplayName(name) {
     return name
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;')
       .substring(0, 50);
   }
   ```

3. **Avoid eval():**
   - Never use `eval()` with stored data
   - Use `JSON.parse()` exclusively

4. **Secure JSON Parsing:**
   ```javascript
   try {
     const peerData = JSON.parse(storedData);
     // Validate structure
     if (!peerData.peerId || typeof peerData.peerId !== 'string') {
       throw new Error('Invalid peer data');
     }
   } catch (e) {
     console.error('Failed to parse peer data:', e);
     return null;
   }
   ```

### 3. Data Validation

**Always validate stored data:**

```javascript
function validatePeerData(peer) {
  const required = ['peerId', 'displayName', 'publicKey', 'lastSeen'];

  for (const field of required) {
    if (!peer[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Type checks
  if (typeof peer.peerId !== 'string') {
    throw new Error('peerId must be string');
  }

  if (typeof peer.lastSeen !== 'number') {
    throw new Error('lastSeen must be number');
  }

  // Range checks
  if (peer.reconnectionAttempts < 0 || peer.reconnectionAttempts > 100) {
    throw new Error('Invalid reconnectionAttempts');
  }

  return true;
}
```

### 4. Logout Cleanup

**Clear sensitive data on logout:**

```javascript
async function onUserLogout() {
  // Clear all peer data
  await peerPersistence.clearAll();

  // Clear other sensitive data
  localStorage.removeItem('mesh:encryption:key');
  sessionStorage.clear();

  // Disconnect all peers
  peerManager.disconnectAll();
}
```

### 5. Privacy Considerations

**Minimize stored PII:**
- Don't store full IP addresses (hash or truncate)
- Don't store location data
- Allow users to clear specific peers
- Provide data export (GDPR compliance)

**Example:**
```javascript
function anonymizeIP(ip) {
  // Store only /24 subnet for IPv4
  return ip.replace(/\.\d+$/, '.0');
}
```

---

## Query Patterns

### 1. Get Peers by Recency

```javascript
// Most recently seen peers
const recentPeers = await peerPersistence.queryPeers({
  sortBy: 'lastSeen',
  order: 'desc',
  limit: 10,
  maxAge: 24 * 60 * 60 * 1000, // Last 24 hours
});
```

**Use case:** Show "recently active" list

**Performance:** O(n) where n = total peers

### 2. Get Peers by Quality

```javascript
// Highest quality connections
const qualityPeers = await peerPersistence.queryPeers({
  sortBy: 'quality',
  order: 'desc',
  limit: 5,
  minQuality: 70, // Score 70-100
});
```

**Use case:** Select peers for message routing

**Performance:** O(n log n) - requires quality calculation

### 3. Get Reconnection Candidates

```javascript
// Smart reconnection selection
const candidates = await peerPersistence.getReconnectionCandidates({
  limit: 10,
  maxAge: 7 * 24 * 60 * 60 * 1000, // Last 7 days
});

// Candidates are sorted by reconnection priority score
for (const candidate of candidates) {
  console.log(`${candidate.peer.displayName}: score ${candidate.score}`);
  console.log(`Reason: ${candidate.reason}`);
}
```

**Use case:** Automatic reconnection after page refresh

**Performance:** O(n log n) - includes scoring

### 4. Filter by Connection Type

```javascript
// Get only direct (host) connections
const allPeers = await peerPersistence.queryPeers();
const directConnections = allPeers.filter(
  peer => peer.connectionQuality?.connectionType === 'host'
);
```

**Use case:** Prefer direct connections for low-latency

### 5. Find Peers with Shared Secrets

```javascript
// Get authenticated peers
const allPeers = await peerPersistence.queryPeers();
const authenticated = allPeers.filter(
  peer => peer.sharedSecret !== null && peer.sharedSecret !== undefined
);
```

**Use case:** Send encrypted messages to trusted peers

---

## Cleanup Strategies

### 1. Age-Based Cleanup

**Remove peers not seen in 30 days:**

```javascript
async function cleanupByAge() {
  const now = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

  const peers = await peerPersistence.queryPeers();
  let removed = 0;

  for (const peer of peers) {
    if (now - peer.lastSeen > maxAge) {
      await peerPersistence.removePeer(peer.peerId);
      removed++;
    }
  }

  return removed;
}
```

**Pros:**
- Simple to understand
- Predictable behavior

**Cons:**
- May remove high-quality peers
- Doesn't consider connection history

### 2. Connection-Based Cleanup

**Remove after N failed reconnection attempts:**

```javascript
async function cleanupByFailures() {
  const maxFailures = 5;
  const peers = await peerPersistence.queryPeers();
  let removed = 0;

  for (const peer of peers) {
    if (peer.reconnectionAttempts >= maxFailures) {
      // Check if blacklist expired
      if (!peer.blacklistUntil || peer.blacklistUntil < Date.now()) {
        await peerPersistence.removePeer(peer.peerId);
        removed++;
      }
    }
  }

  return removed;
}
```

**Pros:**
- Removes unreliable peers
- Keeps working connections

**Cons:**
- May remove temporarily offline peers
- Requires blacklist management

### 3. LRU (Least Recently Used)

**Keep only top N most recent peers:**

```javascript
async function cleanupLRU(keepCount = 50) {
  const peers = await peerPersistence.queryPeers({
    sortBy: 'lastSeen',
    order: 'desc',
  });

  // Remove peers beyond keepCount
  let removed = 0;
  for (let i = keepCount; i < peers.length; i++) {
    await peerPersistence.removePeer(peers[i].peerId);
    removed++;
  }

  return removed;
}
```

**Pros:**
- Guarantees maximum peer count
- Simple to implement

**Cons:**
- May remove high-quality old peers
- Ignores connection quality

### 4. Quality-Based Cleanup

**Remove lowest quality peers when at capacity:**

```javascript
async function cleanupByQuality(targetCount = 80) {
  const peers = await peerPersistence.queryPeers({
    sortBy: 'quality',
    order: 'asc', // Worst quality first
  });

  if (peers.length <= targetCount) {
    return 0; // No cleanup needed
  }

  // Remove worst peers
  const toRemove = peers.length - targetCount;
  let removed = 0;

  for (let i = 0; i < toRemove; i++) {
    await peerPersistence.removePeer(peers[i].peerId);
    removed++;
  }

  return removed;
}
```

**Pros:**
- Keeps best connections
- Improves overall mesh quality

**Cons:**
- More complex scoring
- May remove recent peers

### 5. Hybrid Strategy (Recommended)

**Combine multiple strategies:**

```javascript
async function smartCleanup() {
  const now = Date.now();
  const peers = await peerPersistence.queryPeers();

  for (const peer of peers) {
    let shouldRemove = false;

    // Rule 1: Too old
    const daysOld = (now - peer.lastSeen) / (1000 * 60 * 60 * 24);
    if (daysOld > 30) {
      shouldRemove = true;
    }

    // Rule 2: Too many failures
    if (peer.reconnectionAttempts >= 5 &&
        (!peer.blacklistUntil || peer.blacklistUntil < now)) {
      shouldRemove = true;
    }

    // Rule 3: Never connected successfully
    if (peer.connectionQuality.successfulConnections === 0 &&
        daysOld > 7) {
      shouldRemove = true;
    }

    // Rule 4: Very low quality
    const qualityScore = peerPersistence.calculateQualityScore(peer);
    if (qualityScore < 20 && daysOld > 14) {
      shouldRemove = true;
    }

    if (shouldRemove) {
      await peerPersistence.removePeer(peer.peerId);
    }
  }

  // Final check: LRU if still over limit
  const remaining = await peerPersistence.getAllPeerIds();
  if (remaining.length > 100) {
    await cleanupLRU(80);
  }
}
```

### 6. Scheduled Cleanup

**Run cleanup periodically:**

```javascript
// Run every 6 hours
setInterval(async () => {
  if (await peerPersistence.needsCleanup()) {
    await peerPersistence.cleanupStalePeers();
  }
}, 6 * 60 * 60 * 1000);
```

---

## Integration Guide

### Step 1: Initialize on App Startup

```javascript
import peerPersistence from './storage/peer-persistence.js';

async function initApp() {
  // Initialize storage
  await peerPersistence.initialize();

  // Schedule maintenance
  setInterval(async () => {
    if (await peerPersistence.needsCleanup()) {
      await peerPersistence.cleanupStalePeers();
    }
  }, 6 * 60 * 60 * 1000);

  // Attempt automatic reconnection
  await attemptAutoReconnect();
}

window.addEventListener('load', initApp);
```

### Step 2: Store Peers on Connection

```javascript
import { createPeerData } from './storage/peer-persistence.js';

peerManager.on('connect', async (peerId, peerInfo) => {
  // Create peer data
  const peerData = createPeerData({
    peerId: peerInfo.peerId,
    userId: peerInfo.userId,
    displayName: peerInfo.displayName,
    publicKey: JSON.stringify(peerInfo.publicKey),
    sharedSecret: peerInfo.sharedSecret,
    iceServers: ICE_CONFIG.iceServers,
    cachedCandidates: peerInfo.iceCandidates,
  });

  // Store peer
  await peerPersistence.storePeer(peerData);

  console.log(`Stored peer ${peerId}`);
});
```

### Step 3: Update Quality Metrics

```javascript
// On latency measurement
peerManager.on('latency', async (peerId, latency, connectionType) => {
  await peerPersistence.updateConnectionQuality(peerId, {
    latency,
    connectionType,
  });
});

// On connection close
peerManager.on('disconnect', async (peerId, uptime) => {
  const peer = await peerPersistence.getPeer(peerId);
  if (!peer) return;

  const updatedQuality = updateQualityMetrics(
    peer.connectionQuality,
    { uptime, success: true }
  );

  await peerPersistence.updateConnectionQuality(peerId, updatedQuality);
});
```

### Step 4: Implement Auto-Reconnection

```javascript
async function attemptAutoReconnect() {
  // Get best reconnection candidates
  const candidates = await peerPersistence.getReconnectionCandidates({
    limit: 5,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });

  for (const candidate of candidates) {
    try {
      // Attempt reconnection
      const success = await peerManager.connect(
        candidate.peer.peerId,
        {
          iceServers: candidate.peer.iceServers,
          cachedCandidates: candidate.peer.cachedCandidates,
        }
      );

      if (success) {
        console.log(`Reconnected to ${candidate.peer.displayName}`);
        await peerPersistence.updateLastSeen(candidate.peer.peerId);
      } else {
        await peerPersistence.incrementReconnectionAttempts(
          candidate.peer.peerId
        );
      }
    } catch (error) {
      console.error('Reconnection failed:', error);
      await peerPersistence.incrementReconnectionAttempts(
        candidate.peer.peerId
      );
    }
  }
}
```

### Step 5: Handle IP Changes

```javascript
// Listen for IP change announcements
peerManager.on('message', async (peerId, message) => {
  if (message.type === 'ip-change-announcement') {
    console.log(`Peer ${peerId} announced IP change`);

    const peer = await peerPersistence.getPeer(peerId);
    if (!peer) return;

    // Update cached candidates
    peer.cachedCandidates = message.newCandidates;
    peer.lastKnownIP = message.newIP;
    peer.lastSeen = Date.now();

    await peerPersistence.storePeer(peer);

    // Attempt reconnection with new candidates
    await attemptReconnectWithNewIP(peerId, message.newCandidates);
  }
});
```

---

## Best Practices

### 1. Performance

✅ **DO:**
- Initialize storage once on app startup
- Batch updates when possible
- Use indexes for frequent lookups
- Cache frequently accessed peers in memory
- Run cleanup during idle times

❌ **DON'T:**
- Query all peers on every connection
- Store large binary data (use IndexedDB instead)
- Perform synchronous localStorage operations
- Update storage on every ping/pong

### 2. Data Integrity

✅ **DO:**
- Validate all data before storing
- Use schema versioning
- Implement migration functions
- Handle parse errors gracefully
- Keep backups of critical peers

❌ **DON'T:**
- Trust user input without sanitization
- Skip validation on reads
- Ignore parse errors
- Store raw HTML/scripts

### 3. Privacy

✅ **DO:**
- Encrypt shared secrets
- Anonymize IP addresses
- Provide data export
- Allow selective peer deletion
- Clear data on logout

❌ **DON'T:**
- Store passwords or credentials
- Log sensitive data
- Share peer data across origins
- Keep data after user deletion request

### 4. Storage Management

✅ **DO:**
- Monitor storage usage
- Implement automatic cleanup
- Set peer count limits
- Handle quota exceeded errors
- Provide manual cleanup option

❌ **DON'T:**
- Store unlimited peers
- Ignore storage limits
- Keep stale data indefinitely
- Crash on quota exceeded

---

## Troubleshooting

### Problem: "QuotaExceededError"

**Cause:** localStorage full

**Solutions:**
```javascript
try {
  localStorage.setItem(key, value);
} catch (e) {
  if (e.name === 'QuotaExceededError') {
    // Emergency cleanup
    await peerPersistence.cleanupLRU(50);
    // Retry
    localStorage.setItem(key, value);
  }
}
```

### Problem: Corrupted peer data

**Cause:** Invalid JSON or partial write

**Solutions:**
```javascript
async function validateAndRepair() {
  const peerIds = await peerPersistence.getAllPeerIds();

  for (const peerId of peerIds) {
    try {
      const peer = await peerPersistence.getPeer(peerId);

      // Validate required fields
      if (!peer || !peer.peerId || !peer.displayName) {
        console.warn(`Removing corrupted peer: ${peerId}`);
        await peerPersistence.removePeer(peerId);
      }
    } catch (e) {
      console.error(`Failed to load peer ${peerId}:`, e);
      await peerPersistence.removePeer(peerId);
    }
  }
}
```

### Problem: Slow queries

**Cause:** Too many peers or complex filtering

**Solutions:**
```javascript
// Use limits
const peers = await peerPersistence.queryPeers({
  limit: 20, // Don't load all peers
});

// Cache results
let cachedRecentPeers = null;
let cacheTimestamp = 0;

async function getRecentPeers() {
  const now = Date.now();

  // Cache for 5 minutes
  if (cachedRecentPeers && (now - cacheTimestamp) < 5 * 60 * 1000) {
    return cachedRecentPeers;
  }

  cachedRecentPeers = await peerPersistence.queryPeers({
    sortBy: 'lastSeen',
    limit: 20,
  });
  cacheTimestamp = now;

  return cachedRecentPeers;
}
```

### Problem: Failed reconnections

**Cause:** Stale ICE candidates or changed network

**Solutions:**
```javascript
// Retry with fresh candidates
async function reconnectWithFreshCandidates(peerId) {
  const peer = await peerPersistence.getPeer(peerId);
  if (!peer) return false;

  // Clear stale candidates
  peer.cachedCandidates = [];

  // Use current ICE configuration
  peer.iceServers = ICE_CONFIG.iceServers;

  await peerPersistence.storePeer(peer);

  // Attempt connection
  return await peerManager.connect(peerId, {
    iceServers: peer.iceServers,
    trickle: true, // Use trickle ICE for fresh candidates
  });
}
```

---

## Performance Benchmarks

### Typical Operation Times

| Operation | Time | Notes |
|-----------|------|-------|
| Store peer | ~5-10 ms | Includes encryption |
| Get peer | ~2-5 ms | Includes decryption |
| Query 100 peers | ~50-100 ms | With sorting |
| Cleanup stale | ~200-500 ms | 100 peers |
| Full export | ~100-200 ms | 100 peers |

### Optimization Tips

1. **Batch Operations:**
   ```javascript
   // Bad: Sequential
   for (const peer of peers) {
     await peerPersistence.storePeer(peer);
   }

   // Good: Parallel
   await Promise.all(
     peers.map(peer => peerPersistence.storePeer(peer))
   );
   ```

2. **Lazy Loading:**
   ```javascript
   // Only load peer data when needed
   const peerIds = await peerPersistence.getAllPeerIds();
   // Show IDs in list

   // Load full data on click
   const peer = await peerPersistence.getPeer(selectedId);
   ```

3. **Debounce Updates:**
   ```javascript
   const debouncedUpdate = debounce(async (peerId) => {
     await peerPersistence.updateLastSeen(peerId);
   }, 5000);

   // Call frequently, but only updates every 5 seconds
   debouncedUpdate(peerId);
   ```

---

## Conclusion

This peer persistence system provides a robust foundation for automatic reconnection in P2P applications. By following the guidelines and best practices in this document, you can build a reliable mesh network that survives page refreshes, IP changes, and network interruptions without requiring centralized infrastructure.

For questions or issues, refer to the troubleshooting section or consult the example implementations in `peer-persistence-examples.js`.
