# ReconnectionManager Integration Guide

Complete guide for integrating the WebRTC reconnection system into your P2P mesh chat application.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step-by-Step Integration](#step-by-step-integration)
3. [Architecture Overview](#architecture-overview)
4. [Required Interfaces](#required-interfaces)
5. [Configuration](#configuration)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

Before integrating ReconnectionManager, ensure you have:

- ✅ **MeshRouter** - Message routing with flood routing (`/src/mesh-router.js`)
- ✅ **PeerManager** - Peer connection management with SimplePeer
- ✅ **PeerPersistence** - Optional peer data storage (`/src/storage/peer-persistence.js`)
- ✅ **ICE Configuration** - STUN/TURN servers (`/src/config/ice-config.js`)
- ✅ **SimplePeer** - WebRTC library

## Step-by-Step Integration

### Step 1: Import Dependencies

```javascript
// In your main mesh network file (e.g., mesh.js)
import ReconnectionManager from './reconnection/relay-reconnection.js';
import MessageRouter from './mesh-router.js';
import peerPersistence from './storage/peer-persistence.js';
```

### Step 2: Initialize ReconnectionManager

```javascript
class MeshNetwork {
  constructor(identity) {
    this.identity = identity; // { uuid, displayName }

    // Initialize core components
    this.router = new MessageRouter(identity);
    this.peerManager = new PeerManager();

    // Initialize ReconnectionManager
    this.reconnectionManager = new ReconnectionManager(
      this.identity,
      this.router,
      this.peerManager,
      peerPersistence // Can be null if not using persistence
    );

    // Connect router to peer manager
    this.router.setPeerManager(this.peerManager);

    console.log('[Mesh] Initialized with reconnection support');
  }
}
```

### Step 3: Implement Required PeerManager Methods

Your PeerManager must implement:

```javascript
class PeerManager {
  constructor() {
    this.peers = new Map(); // peerId -> peer data
    this.maxConnections = 6;
  }

  /**
   * Get count of connected peers
   * @returns {number}
   */
  getConnectedPeerCount() {
    return Array.from(this.peers.values())
      .filter(p => p.status === 'connected')
      .length;
  }

  /**
   * Register a reconnected peer connection
   * Called by ReconnectionManager when reconnection succeeds
   *
   * @param {string} peerId - Peer ID
   * @param {string} peerName - Display name
   * @param {SimplePeer} peerConnection - WebRTC peer connection
   */
  registerReconnectedPeer(peerId, peerName, peerConnection) {
    console.log(`[PeerManager] Registering reconnected peer: ${peerName}`);

    // Add to peers map
    this.peers.set(peerId, {
      peer: peerConnection,
      status: 'connected',
      displayName: peerName,
      connectedAt: Date.now(),
      reconnected: true
    });

    // Set up standard peer event handlers
    this.setupPeerHandlers(peerId, peerConnection);

    // Emit event for UI updates
    this.emit('peer:reconnected', peerId, peerName);
  }

  /**
   * Set up event handlers for a peer connection
   */
  setupPeerHandlers(peerId, peer) {
    peer.on('data', data => {
      try {
        const message = JSON.parse(data.toString());
        this.router.routeMessage(message, peerId);
      } catch (e) {
        console.error('[PeerManager] Failed to parse message:', e);
      }
    });

    peer.on('close', () => {
      console.log(`[PeerManager] Peer ${peerId} closed`);
      const peerData = this.peers.get(peerId);
      if (peerData) {
        peerData.status = 'disconnected';
        this.emit('peer:disconnect', peerId, peerData.displayName);
      }
    });

    peer.on('error', err => {
      console.error(`[PeerManager] Peer ${peerId} error:`, err);
    });
  }
}
```

### Step 4: Add Reconnection on Disconnect

```javascript
class MeshNetwork {
  constructor(identity) {
    // ... initialization code ...

    // Set up automatic reconnection
    this.setupAutoReconnection();
  }

  setupAutoReconnection() {
    this.peerManager.on('peer:disconnect', async (peerId, peerName) => {
      console.log(`[Mesh] Peer ${peerName} disconnected`);

      // Store peer data for reconnection
      await this.storePeerData(peerId, peerName);

      // Schedule reconnection attempt
      setTimeout(async () => {
        console.log(`[Mesh] Attempting to reconnect to ${peerName}...`);

        const result = await this.reconnectionManager.reconnectViaMesh(
          peerId,
          peerName
        );

        if (result.success) {
          console.log(`[Mesh] Successfully reconnected to ${peerName}`);
        } else {
          console.log(`[Mesh] Reconnection failed: ${result.reason}`);

          // Optionally retry with exponential backoff
          if (result.reason === 'no_path_found') {
            this.scheduleRetry(peerId, peerName);
          }
        }
      }, 5000); // Wait 5 seconds before reconnecting
    });
  }

  async storePeerData(peerId, peerName) {
    if (!peerPersistence) return;

    try {
      // Check if peer exists
      const existing = await peerPersistence.getPeer(peerId);

      if (existing) {
        await peerPersistence.updateLastSeen(peerId);
      } else {
        // Create new peer entry
        const peerData = {
          peerId,
          displayName: peerName,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          connectionQuality: {
            latency: null,
            successRate: 1.0,
            connectionType: null,
            lastMeasured: Date.now(),
            totalConnections: 1,
            successfulConnections: 1,
            avgUptime: 0
          },
          reconnectionAttempts: 0
        };

        await peerPersistence.storePeer(peerData);
      }
    } catch (error) {
      console.error('[Mesh] Failed to store peer data:', error);
    }
  }

  scheduleRetry(peerId, peerName, attempt = 1, maxAttempts = 3) {
    if (attempt > maxAttempts) {
      console.log(`[Mesh] Max reconnection attempts reached for ${peerName}`);
      return;
    }

    const delay = Math.min(5000 * Math.pow(2, attempt - 1), 60000);

    setTimeout(async () => {
      console.log(`[Mesh] Retry ${attempt}/${maxAttempts} for ${peerName}...`);

      const result = await this.reconnectionManager.reconnectViaMesh(
        peerId,
        peerName
      );

      if (!result.success && result.reason === 'no_path_found') {
        this.scheduleRetry(peerId, peerName, attempt + 1, maxAttempts);
      }
    }, delay);
  }
}
```

### Step 5: Add Manual Reconnection UI

```javascript
// In your UI code

/**
 * Show disconnected peers with reconnect buttons
 */
async function showDisconnectedPeers() {
  const candidates = await peerPersistence.getReconnectionCandidates({
    limit: 10,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  const container = document.getElementById('disconnected-peers');

  container.innerHTML = candidates.map(c => `
    <div class="peer-item" data-peer-id="${c.peer.peerId}">
      <span class="peer-name">${c.peer.displayName}</span>
      <span class="peer-score">Score: ${c.score}/100</span>
      <button
        class="reconnect-btn"
        onclick="reconnectToPeer('${c.peer.peerId}', '${c.peer.displayName}')"
      >
        Reconnect
      </button>
    </div>
  `).join('');
}

/**
 * Handle reconnect button click
 */
async function reconnectToPeer(peerId, peerName) {
  const button = document.querySelector(
    `[data-peer-id="${peerId}"] .reconnect-btn`
  );

  button.disabled = true;
  button.textContent = 'Connecting...';

  const result = await meshNetwork.reconnectionManager.reconnectViaMesh(
    peerId,
    peerName
  );

  if (result.success) {
    button.textContent = '✓ Connected';
    setTimeout(() => showDisconnectedPeers(), 2000);
  } else {
    button.disabled = false;
    button.textContent = 'Retry';
    alert(`Failed to reconnect: ${result.reason}`);
  }
}
```

## Architecture Overview

### Component Relationships

```
┌─────────────────────────────────────────────────────────┐
│                    Mesh Network                         │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────┐ │
│  │              │    │              │    │          │ │
│  │ PeerManager  │◄───┤  MeshRouter  │───►│  UI      │ │
│  │              │    │              │    │          │ │
│  └──────┬───────┘    └──────┬───────┘    └──────────┘ │
│         │                   │                          │
│         │                   │                          │
│         ▼                   ▼                          │
│  ┌──────────────────────────────────────┐             │
│  │   ReconnectionManager                │             │
│  │   ┌────────────────────────────┐    │             │
│  │   │ Path Discovery             │    │             │
│  │   │ - PATH_QUERY               │    │             │
│  │   │ - PATH_RESPONSE            │    │             │
│  │   └────────────────────────────┘    │             │
│  │   ┌────────────────────────────┐    │             │
│  │   │ Relay Signaling            │    │             │
│  │   │ - RECONNECT_OFFER          │    │             │
│  │   │ - RECONNECT_ANSWER         │    │             │
│  │   └────────────────────────────┘    │             │
│  │   ┌────────────────────────────┐    │             │
│  │   │ State Management           │    │             │
│  │   │ - Pending Reconnections    │    │             │
│  │   │ - Active Queries           │    │             │
│  │   └────────────────────────────┘    │             │
│  └──────┬───────────────────────────────┘             │
│         │                                             │
│         ▼                                             │
│  ┌──────────────┐                                     │
│  │ Peer         │                                     │
│  │ Persistence  │                                     │
│  └──────────────┘                                     │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Message Flow

```
1. Path Discovery Phase
   ┌──────┐                  ┌──────┐                  ┌──────┐
   │Peer A│                  │Relay │                  │Peer B│
   └──┬───┘                  └──┬───┘                  └──┬───┘
      │                         │                         │
      │───PATH_QUERY──────────► │                         │
      │                         │                         │
      │                         │───PATH_QUERY──────────► │
      │                         │                         │
      │                         │ ◄─────PATH_RESPONSE──── │
      │                         │                         │
      │ ◄─────PATH_RESPONSE──── │                         │
      │                         │                         │

2. Signaling Phase
      │                         │                         │
      │───RECONNECT_OFFER─────► │                         │
      │                         │                         │
      │                         │───RECONNECT_OFFER─────► │
      │                         │                         │
      │                         │ ◄────RECONNECT_ANSWER── │
      │                         │                         │
      │ ◄────RECONNECT_ANSWER── │                         │
      │                         │                         │

3. WebRTC Connection
      │                         │                         │
      │◄═══════════════════════════════════════════════► │
      │            WebRTC Connection                      │
      │                         │                         │
```

## Required Interfaces

### Identity Object

```typescript
interface Identity {
  uuid: string;        // Unique peer identifier
  displayName: string; // Human-readable name
}
```

### PeerManager Interface

```typescript
interface PeerManager {
  // Peer storage
  peers: Map<string, PeerData>;
  maxConnections: number;

  // Required methods
  getConnectedPeerCount(): number;
  registerReconnectedPeer(
    peerId: string,
    peerName: string,
    peerConnection: SimplePeer
  ): void;
}
```

### PeerPersistence Interface (Optional)

```typescript
interface PeerPersistence {
  updateLastSeen(peerId: string): Promise<void>;
  incrementReconnectionAttempts(peerId: string): Promise<void>;
  getReconnectionCandidates(options: {
    limit: number;
    maxAge: number;
  }): Promise<ReconnectionCandidate[]>;
}
```

## Configuration

### Default Configuration

```javascript
{
  reconnectTimeout: 30000,      // 30 seconds
  pathQueryTimeout: 5000,       // 5 seconds
  answerTimeout: 25000,         // 25 seconds
  maxConcurrentReconnects: 5,   // Max simultaneous attempts
  pathQueryTTL: 7,              // Message TTL for queries
  offerTTL: 10,                 // Message TTL for offers
  cleanupInterval: 60000        // Cleanup interval
}
```

### Custom Configuration

```javascript
// After initialization, modify config:
reconnectionManager.config.reconnectTimeout = 45000; // 45 seconds
reconnectionManager.config.maxConcurrentReconnects = 10;
```

## Testing

### Unit Tests

Run the test suite:

```bash
npm test src/reconnection/relay-reconnection.test.js
```

### Integration Test

```javascript
// Test in browser console

// 1. Test path discovery
const hasPath = await meshNetwork.reconnectionManager.findPathToTarget(
  'target-peer-id',
  5000
);
console.log('Has path:', hasPath);

// 2. Test reconnection
const result = await meshNetwork.reconnectionManager.reconnectViaMesh(
  'target-peer-id',
  'Target Peer'
);
console.log('Reconnection result:', result);

// 3. Check statistics
const stats = meshNetwork.reconnectionManager.getStats();
console.log('Statistics:', stats);

// 4. Check state
const state = meshNetwork.reconnectionManager.getState();
console.log('Current state:', state);
```

### Manual Testing Checklist

- [ ] Peer disconnects and reconnects automatically
- [ ] Path discovery finds connected peers
- [ ] WebRTC connection establishes successfully
- [ ] Rejection works for duplicate connections
- [ ] Deterministic tie-breaking prevents duplicates
- [ ] Connection limits are respected
- [ ] Statistics update correctly
- [ ] Cleanup removes stale state
- [ ] Error handling works for all failure cases

## Troubleshooting

### Common Issues

#### 1. "No path found" Always

**Symptoms**: Reconnection always fails with `no_path_found`

**Solutions**:
- Verify mesh router is forwarding PATH_QUERY messages
- Check that TTL is sufficient (default: 7)
- Ensure at least one mutual peer is online
- Check network connectivity

**Debug**:
```javascript
// Check if path query is sent
const router = meshNetwork.router;
console.log('Sent messages:', router.getStats());

// Monitor path queries
meshNetwork.router.on('path_query', msg => {
  console.log('[DEBUG] Path query:', msg);
});
```

#### 2. Reconnection Times Out

**Symptoms**: Reconnection takes full 30 seconds and fails

**Solutions**:
- Check WebRTC signaling is working
- Verify ICE configuration includes TURN servers
- Check firewall/NAT settings
- Increase timeout if on slow network

**Debug**:
```javascript
// Monitor reconnection state
setInterval(() => {
  const state = reconnectionManager.getState();
  console.log('[DEBUG] Pending reconnections:', state.pendingReconnects);
}, 1000);
```

#### 3. Duplicate Connections

**Symptoms**: Both peers connect to each other simultaneously

**Solutions**:
- Verify `shouldAcceptReconnection` implements tie-breaking
- Ensure both peers use same UUID comparison
- Check that peer IDs are consistent

**Debug**:
```javascript
// Log acceptance decisions
const originalShouldAccept = reconnectionManager.shouldAcceptReconnection;
reconnectionManager.shouldAcceptReconnection = function(peerId) {
  const result = originalShouldAccept.call(this, peerId);
  console.log('[DEBUG] Should accept', peerId, '?', result);
  console.log('[DEBUG] Comparison:', this.identity.uuid, '<', peerId, '=', this.identity.uuid < peerId);
  return result;
};
```

#### 4. Memory Leaks

**Symptoms**: Memory usage grows over time

**Solutions**:
- Ensure `stop()` is called on shutdown
- Verify cleanup timer is running
- Check that peer connections are destroyed

**Debug**:
```javascript
// Monitor state sizes
setInterval(() => {
  console.log('[DEBUG] Pending reconnects:', reconnectionManager.pendingReconnects.size);
  console.log('[DEBUG] Active queries:', reconnectionManager.activeQueries.size);
  console.log('[DEBUG] Path responses:', reconnectionManager.pathQueryResponses.size);
}, 10000);
```

#### 5. Messages Not Routed

**Symptoms**: PATH_RESPONSE or RECONNECT_ANSWER never arrives

**Solutions**:
- Verify message handlers are registered
- Check router is forwarding targeted messages
- Ensure TTL is not exhausted
- Verify message structure is valid

**Debug**:
```javascript
// Monitor all reconnection messages
for (const msgType of Object.values(RECONNECT_MESSAGE_TYPES)) {
  meshNetwork.router.on(msgType, msg => {
    console.log(`[DEBUG] Received ${msgType}:`, msg);
  });
}
```

## Performance Optimization

### Reduce Reconnection Time

```javascript
// Reduce timeouts for faster reconnection
reconnectionManager.config.pathQueryTimeout = 3000;  // 3s
reconnectionManager.config.reconnectTimeout = 20000; // 20s
```

### Batch Reconnections

```javascript
async function reconnectMultiple(peerIds) {
  const maxConcurrent = 3;
  const results = [];

  for (let i = 0; i < peerIds.length; i += maxConcurrent) {
    const batch = peerIds.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(peerId => reconnectionManager.reconnectViaMesh(peerId))
    );
    results.push(...batchResults);
  }

  return results;
}
```

### Priority-Based Reconnection

```javascript
async function reconnectByPriority() {
  const candidates = await peerPersistence.getReconnectionCandidates({
    limit: 10,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  // Reconnect to high-quality peers first
  for (const candidate of candidates) {
    if (candidate.score > 80) {
      await reconnectionManager.reconnectViaMesh(
        candidate.peer.peerId,
        candidate.peer.displayName
      );
    }
  }
}
```

## Best Practices

1. **Always handle errors**: Check `result.success` and `result.reason`
2. **Use exponential backoff**: Don't retry immediately on failure
3. **Respect connection limits**: Don't exceed `maxConnections`
4. **Store peer data**: Use PeerPersistence for better reconnection
5. **Monitor statistics**: Track success rates and adjust timeouts
6. **Test with different networks**: Corporate, mobile, restrictive NATs
7. **Provide user feedback**: Show reconnection status in UI
8. **Clean up on shutdown**: Call `stop()` to prevent leaks

## Additional Resources

- [README.md](./README.md) - Complete API documentation
- [example-integration.js](./example-integration.js) - Working examples
- [relay-reconnection.js](./relay-reconnection.js) - Source code with JSDoc
- [relay-reconnection.test.js](./relay-reconnection.test.js) - Unit tests

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the test suite for examples
3. Enable verbose logging with console filters
4. Open an issue on GitHub with debug logs

---

**Version**: 1.0.0
**Last Updated**: 2024-11-21
**License**: MIT
