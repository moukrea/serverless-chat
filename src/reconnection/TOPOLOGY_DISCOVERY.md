# Mesh Topology Discovery

Production-ready module for discovering and mapping mesh network topology in P2P chat applications.

## Overview

The `MeshTopologyManager` discovers "who's connected to whom" in your mesh network, enabling:

- **Intelligent relay selection** - Find peers that can relay to disconnected targets
- **Path finding** - Discover multi-hop routes through the mesh
- **Network visualization** - Generate data for topology graphs
- **Mesh health monitoring** - Assess connectivity and identify bottlenecks
- **Reconnection optimization** - Choose best paths for automatic reconnection

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Mesh Network                               │
│                                                              │
│  ┌──────┐    ┌──────┐    ┌──────┐                          │
│  │ You  │────│Peer A│────│Peer B│                          │
│  └──────┘    └──────┘    └──────┘                          │
│      │           │            │                              │
│      │      ┌──────┐     ┌──────┐                          │
│      └──────│Peer C│─────│Peer D│                          │
│             └──────┘     └──────┘                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                          │
                          ↓
         ┌──────────────────────────────────┐
         │   MeshTopologyManager             │
         │                                   │
         │  ┌─────────────────────────────┐ │
         │  │  Topology Map                │ │
         │  │  ─────────────               │ │
         │  │  Peer A → [You, Peer B]     │ │
         │  │  Peer B → [Peer A, Peer D]  │ │
         │  │  Peer C → [You, Peer D]     │ │
         │  │  Peer D → [Peer B, Peer C]  │ │
         │  └─────────────────────────────┘ │
         │                                   │
         │  • Path Finding (BFS)             │
         │  • Relay Selection                │
         │  • Quality Scoring                │
         │  • Role Detection                 │
         └──────────────────────────────────┘
```

## How It Works

### 1. Topology Discovery

The manager broadcasts a `TOPOLOGY_REQUEST` to all peers in the mesh:

```javascript
{
  type: 'topology_request',
  payload: {
    requestId: 'topo-abc-123-456',
    requesterId: 'user-abc-123',
    timestamp: 1700000000000
  },
  routingHint: 'broadcast',
  ttl: 5
}
```

Each peer responds with their local connection information:

```javascript
{
  type: 'topology_response',
  payload: {
    requestId: 'topo-abc-123-456',
    responderId: 'peer-def-456',
    responderName: 'Bob',
    connectedPeers: [
      {
        peerId: 'peer-ghi-789',
        displayName: 'Charlie',
        latency: 75,
        uptime: 450,
        connectionQuality: 85
      }
    ],
    metadata: {
      totalConnections: 1,
      meshRole: 'relay'
    }
  },
  targetPeerId: 'user-abc-123'
}
```

The manager collects responses for a configurable timeout (default 10 seconds) and builds a complete connectivity graph.

### 2. Path Finding (BFS Algorithm)

Uses **Breadth-First Search** to find shortest paths to any peer:

**Algorithm:**
```
Input: targetPeerId
Output: Array of paths (each path is array of peer IDs)

1. Initialize queue with [self, []]
2. Mark self as visited
3. While queue not empty and paths < maxPaths:
   a. Dequeue (peerId, path)
   b. Get connections for peerId
   c. For each connection:
      - If connection == target: add path + [peerId, target] to results
      - Else if not visited: enqueue (connection, path + [peerId])
4. Return paths
```

**Complexity:** O(V + E) where V = nodes, E = edges

**Example:**
```javascript
// Find up to 3 paths to peer-xyz-789
const paths = topologyManager.findPathsToPeer('peer-xyz-789', 3);

// Result:
// [
//   ['self', 'peer-abc', 'peer-xyz-789'],           // 2 hops
//   ['self', 'peer-def', 'peer-ghi', 'peer-xyz-789'], // 3 hops
//   ['self', 'peer-jkl', 'peer-xyz-789']            // 2 hops
// ]
```

### 3. Relay Selection

Identifies peers that can relay to a disconnected target:

**Quality Scoring Algorithm:**
```
Base score: 50

+ Connection bonus (up to 30 points):
  - More connections = better hub
  - Score += min(connectionCount * 5, 30)

+ Recency bonus (up to 20 points):
  - Data < 1 minute old: +20
  - Data < 5 minutes old: +10
  - Older data: 0

+ Peer quality bonus (up to 20 points):
  - Average connection quality * 0.2
  - Based on latency, uptime, stability

Final score: min(100, max(0, score))
```

**Example:**
```javascript
const relays = topologyManager.findPotentialRelays('peer-xyz-789');

// Result:
// [
//   {
//     peerId: 'peer-abc-123',
//     displayName: 'Alice',
//     hopCount: 1,
//     quality: 85  // High quality - many connections, fresh data
//   },
//   {
//     peerId: 'peer-def-456',
//     displayName: 'Bob',
//     hopCount: 1,
//     quality: 62  // Medium quality - fewer connections, older data
//   }
// ]
```

### 4. Role Determination

Classifies peers based on connection count:

| Role | Connection Count | Description |
|------|------------------|-------------|
| **Hub** | 5+ | Well-connected, good relay candidate |
| **Relay** | 3-4 | Medium connectivity, can relay |
| **Leaf** | 1-2 | Edge node, limited relay capacity |
| **Isolated** | 0 | No connections, needs reconnection |

## API Reference

### Constructor

```javascript
new MeshTopologyManager(identity, router, peerManager, config)
```

**Parameters:**
- `identity` (Object) - User identity `{uuid, displayName}`
- `router` (MessageRouter) - Message router instance
- `peerManager` (Object) - Peer manager with `peers` Map
- `config` (Object) - Optional configuration

**Config Options:**
```javascript
{
  discoveryTimeout: 10000,      // Wait time for responses (ms)
  discoveryInterval: 60000,     // Periodic discovery interval (ms)
  topologyStaleTime: 300000,    // Data staleness threshold (ms)
  maxPaths: 3,                  // Max paths to find in BFS
  cleanupInterval: 120000,      // Cleanup interval (ms)
  requestTTL: 5,                // Topology request TTL
  responseTTL: 5,               // Topology response TTL
}
```

### Core Methods

#### `discoverTopology(timeout = 10000)`

Request topology information from mesh.

```javascript
const topology = await topologyManager.discoverTopology();

// Returns:
// {
//   self: {
//     peerId: 'user-abc-123',
//     displayName: 'Alice',
//     connections: ['peer-1', 'peer-2'],
//     role: 'relay'
//   },
//   knownPeers: [
//     {
//       peerId: 'peer-1',
//       displayName: 'Bob',
//       connections: ['user-abc-123', 'peer-3'],
//       connectionCount: 2,
//       role: 'relay',
//       lastUpdated: 1700000000000,
//       age: 5000
//     }
//   ],
//   totalNodes: 4,
//   totalEdges: 5
// }
```

#### `findPathsToPeer(targetPeerId, maxPaths = 3)`

Find paths to target peer using BFS.

```javascript
const paths = topologyManager.findPathsToPeer('peer-xyz-789', 3);

// Returns: Array<Array<string>>
// [
//   ['self', 'peer-a', 'peer-xyz-789'],
//   ['self', 'peer-b', 'peer-c', 'peer-xyz-789']
// ]
```

#### `findPotentialRelays(targetPeerId)`

Find peers that can relay to target.

```javascript
const relays = topologyManager.findPotentialRelays('peer-xyz-789');

// Returns: Array<RelayCandidate>
// [
//   {
//     peerId: 'peer-abc-123',
//     displayName: 'Alice',
//     hopCount: 1,
//     quality: 85
//   }
// ]
```

#### `getBestRelayForTarget(targetPeerId)`

Get single best relay for target.

```javascript
const relayId = topologyManager.getBestRelayForTarget('peer-xyz-789');
// Returns: 'peer-abc-123' or null
```

#### `calculateRelayQuality(peerData)`

Calculate relay quality score (0-100).

```javascript
const quality = topologyManager.calculateRelayQuality(peerTopologyData);
// Returns: 85 (0-100)
```

#### `getTopologyView()`

Get current topology snapshot.

```javascript
const view = topologyManager.getTopologyView();
```

#### `determineRole()`

Determine our role in mesh.

```javascript
const role = topologyManager.determineRole();
// Returns: 'hub' | 'relay' | 'leaf' | 'isolated'
```

### Periodic Discovery

#### `startTopologyDiscovery(interval = 60000)`

Start periodic topology discovery.

```javascript
// Discover topology every minute
topologyManager.startTopologyDiscovery(60000);
```

#### `stopTopologyDiscovery()`

Stop periodic discovery.

```javascript
topologyManager.stopTopologyDiscovery();
```

### Statistics

#### `getStats()`

Get statistics and metrics.

```javascript
const stats = topologyManager.getStats();

// Returns:
// {
//   knownPeers: 5,
//   totalNodes: 6,
//   totalEdges: 8,
//   ourRole: 'relay',
//   ourConnections: 3,
//   requestsSent: 12,
//   responsesReceived: 47,
//   topologyUpdates: 12,
//   lastDiscovery: 1700000000000,
//   discoveryInterval: 60000,
//   activeRequests: 0
// }
```

### Utility Methods

#### `clear()`

Clear all topology data.

```javascript
topologyManager.clear();
```

#### `destroy()`

Stop all timers and cleanup.

```javascript
topologyManager.destroy();
```

## Integration Guide

### Step 1: Initialize

```javascript
import MeshTopologyManager from './reconnection/topology-discovery.js';

// Create topology manager
const topologyManager = new MeshTopologyManager(
  identity,      // Your user identity
  router,        // Your MessageRouter instance
  peerManager,   // Your PeerManager instance
  {
    discoveryTimeout: 10000,
    discoveryInterval: 60000,
  }
);
```

### Step 2: Discover Topology

```javascript
// One-time discovery
const topology = await topologyManager.discoverTopology();

// Or start periodic discovery
topologyManager.startTopologyDiscovery(60000); // Every minute
```

### Step 3: Use Topology Data

```javascript
// Find paths to disconnected peer
const paths = topologyManager.findPathsToPeer('peer-xyz-789');

// Find best relay
const relayId = topologyManager.getBestRelayForTarget('peer-xyz-789');

// Use relay for reconnection
if (relayId) {
  await reconnectionManager.reconnectViaRelay('peer-xyz-789', relayId);
}
```

### Step 4: Monitor Mesh Health

```javascript
// Get topology view
const view = topologyManager.getTopologyView();

console.log(`Mesh has ${view.totalNodes} nodes and ${view.totalEdges} edges`);
console.log(`Your role: ${view.self.role}`);

// Get statistics
const stats = topologyManager.getStats();
console.log(`Topology discoveries: ${stats.topologyUpdates}`);
console.log(`Response rate: ${stats.responsesReceived}/${stats.requestsSent}`);
```

## Integration with Reconnection

### Intelligent Relay Selection

```javascript
import MeshTopologyManager from './reconnection/topology-discovery.js';
import RelayReconnectionManager from './reconnection/relay-reconnection.js';

// When peer disconnects
async function handlePeerDisconnect(peerId) {
  // Discover topology
  await topologyManager.discoverTopology(5000);

  // Find best relay
  const relayId = topologyManager.getBestRelayForTarget(peerId);

  if (relayId) {
    // Reconnect via relay
    await relayReconnectionManager.initiateReconnection(peerId, relayId);
  } else {
    // No relay available, try direct reconnection
    await directReconnection.reconnect(peerId);
  }
}
```

### Path-Based Reconnection

```javascript
// Find multiple paths and try each
async function reconnectWithFallback(targetPeerId) {
  const paths = topologyManager.findPathsToPeer(targetPeerId, 5);

  for (const path of paths) {
    // path[1] is the first hop (our relay)
    const relayId = path[1];

    try {
      await relayReconnectionManager.initiateReconnection(
        targetPeerId,
        relayId,
        { timeout: 5000 }
      );
      console.log('Reconnected via', relayId);
      return true;
    } catch (error) {
      console.log('Failed via', relayId, '- trying next path');
    }
  }

  console.log('All paths failed');
  return false;
}
```

## Network Visualization

### Generate Graph Data

```javascript
async function generateGraphData() {
  const topology = await topologyManager.discoverTopology();

  // Build nodes
  const nodes = [
    {
      id: topology.self.peerId,
      label: topology.self.displayName,
      role: topology.self.role,
      isSelf: true,
    },
    ...topology.knownPeers.map(peer => ({
      id: peer.peerId,
      label: peer.displayName,
      role: peer.role,
      isSelf: false,
    }))
  ];

  // Build edges
  const edges = [];
  const edgeSet = new Set();

  // Self connections
  for (const connId of topology.self.connections) {
    const edgeId = [topology.self.peerId, connId].sort().join('-');
    if (!edgeSet.has(edgeId)) {
      edges.push({ source: topology.self.peerId, target: connId });
      edgeSet.add(edgeId);
    }
  }

  // Peer connections
  for (const peer of topology.knownPeers) {
    for (const connId of peer.connections) {
      const edgeId = [peer.peerId, connId].sort().join('-');
      if (!edgeSet.has(edgeId)) {
        edges.push({ source: peer.peerId, target: connId });
        edgeSet.add(edgeId);
      }
    }
  }

  return { nodes, edges };
}
```

### D3.js Integration

```javascript
import * as d3 from 'd3';

async function renderTopologyGraph() {
  const { nodes, edges } = await generateGraphData();

  const svg = d3.select('#topology-graph');
  const width = svg.attr('width');
  const height = svg.attr('height');

  // Create force simulation
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2));

  // Draw edges
  const link = svg.append('g')
    .selectAll('line')
    .data(edges)
    .enter().append('line')
    .attr('stroke', '#999')
    .attr('stroke-width', 2);

  // Draw nodes
  const node = svg.append('g')
    .selectAll('circle')
    .data(nodes)
    .enter().append('circle')
    .attr('r', d => d.isSelf ? 10 : 6)
    .attr('fill', d => {
      if (d.isSelf) return '#2196F3';
      if (d.role === 'hub') return '#4CAF50';
      if (d.role === 'relay') return '#FF9800';
      return '#9E9E9E';
    });

  // Add labels
  const label = svg.append('g')
    .selectAll('text')
    .data(nodes)
    .enter().append('text')
    .text(d => d.label)
    .attr('font-size', 10)
    .attr('dx', 12)
    .attr('dy', 4);

  // Update positions
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node
      .attr('cx', d => d.x)
      .attr('cy', d => d.y);

    label
      .attr('x', d => d.x)
      .attr('y', d => d.y);
  });
}
```

## Performance Considerations

### Time Complexity

- **Topology Discovery**: O(N) where N = number of peers
- **BFS Path Finding**: O(V + E) where V = nodes, E = edges
- **Relay Selection**: O(N) where N = known peers
- **Quality Scoring**: O(1) per peer

### Space Complexity

- **Topology Storage**: O(N * M) where M = avg connections per peer
- **Path Storage**: O(P * H) where P = paths, H = hops per path

### Optimization Tips

1. **Limit Discovery Frequency**: Don't discover more than once per minute
2. **Use Shorter Timeouts**: For background discovery, use 5s timeout instead of 10s
3. **Limit Path Count**: Finding 3 paths is usually sufficient
4. **Clean Stale Data**: Old topology data is automatically cleaned after 5 minutes
5. **Cache Results**: Cache topology view if needed multiple times

### Network Load

- **Discovery Request**: ~200 bytes
- **Discovery Response**: ~100-500 bytes (depends on connection count)
- **Total Traffic**: N * 500 bytes per discovery (where N = peers)
- **Example**: 10 peers = ~5 KB per discovery

## Testing

Run the test suite:

```bash
node src/reconnection/topology-discovery.test.js
```

Run specific test group:

```javascript
// See topology-discovery.test.js for examples
```

## Examples

See `/src/reconnection/topology-discovery.example.js` for comprehensive integration examples including:

1. Basic setup
2. Topology discovery
3. Path finding
4. Relay selection
5. Automatic reconnection
6. Periodic monitoring
7. Mesh health assessment
8. Network visualization
9. React/Vue integration
10. Complete workflow

## Troubleshooting

### No topology responses received

**Cause**: Peers may not be responding to topology requests

**Solutions**:
- Verify router is properly configured
- Check that peer connections are active
- Ensure message handlers are registered
- Increase discovery timeout

### Path finding returns empty array

**Cause**: Target peer is not in topology map

**Solutions**:
- Run topology discovery first
- Check that target peer is connected to mesh
- Verify topology data is not stale

### Relay quality scores are low

**Cause**: Peers have few connections or stale data

**Solutions**:
- Discover topology more frequently
- Encourage peers to maintain more connections
- Check network connectivity

### High memory usage

**Cause**: Large topology map with many peers

**Solutions**:
- Reduce `topologyStaleTime` to clean data more aggressively
- Limit discovery frequency
- Clear topology when not needed

## Best Practices

1. **Discover periodically**: Start periodic discovery with 60s interval
2. **Use short timeouts for background**: Use 5s timeout for non-critical discovery
3. **Cache topology view**: Don't recompute if data is fresh
4. **Clean up on destroy**: Call `destroy()` when component unmounts
5. **Handle errors**: Wrap discovery in try-catch
6. **Limit path count**: 3-5 paths is usually sufficient
7. **Monitor statistics**: Use `getStats()` to track performance

## Future Enhancements

Potential improvements for future versions:

- [ ] **Weighted path finding**: Consider latency and quality in path selection
- [ ] **Topology diff**: Track changes between discoveries
- [ ] **Peer prediction**: Predict peer availability based on history
- [ ] **Centrality analysis**: Identify critical peers using betweenness centrality
- [ ] **Community detection**: Identify clusters in the mesh
- [ ] **Load balancing**: Distribute relay requests across multiple relays
- [ ] **Path caching**: Cache frequently used paths

## License

Part of serverless-chat mesh networking infrastructure.

## Related Modules

- `/src/mesh-router.js` - Message routing with flood algorithm
- `/src/reconnection/relay-reconnection.js` - Relay-based reconnection
- `/src/reconnection/direct-reconnection.js` - Direct reconnection
- `/src/storage/peer-persistence.js` - Peer data persistence

---

**Questions?** Check the examples in `topology-discovery.example.js` or review the test suite in `topology-discovery.test.js`.
