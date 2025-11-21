/**
 * MeshTopologyManager Integration Example
 *
 * Demonstrates how to integrate topology discovery into your mesh chat application
 * for intelligent relay selection and path finding.
 *
 * Use cases:
 * 1. Discover mesh topology on demand
 * 2. Find paths to disconnected peers
 * 3. Select best relay for reconnection
 * 4. Monitor mesh health and connectivity
 * 5. Display network visualization
 */

import MeshTopologyManager from './topology-discovery.js';
import MessageRouter from '../mesh-router.js';
// Import your PeerManager and Identity

// =============================================================================
// BASIC INTEGRATION
// =============================================================================

/**
 * Example 1: Basic Setup
 * Initialize topology manager with existing router and peer manager
 */
async function basicSetup() {
  console.log('=== Example 1: Basic Setup ===\n');

  // Your existing infrastructure
  const identity = {
    uuid: 'user-abc-123',
    displayName: 'Alice',
  };

  const router = new MessageRouter(identity);
  const peerManager = {
    peers: new Map(),
    // ... your peer manager implementation
  };

  // Create topology manager
  const topologyManager = new MeshTopologyManager(
    identity,
    router,
    peerManager,
    {
      discoveryTimeout: 10000,      // 10 seconds
      discoveryInterval: 60000,     // 1 minute
      topologyStaleTime: 300000,    // 5 minutes
    }
  );

  console.log('✓ Topology manager initialized');
  console.log(`  Role: ${topologyManager.determineRole()}`);
  console.log(`  Connected peers: ${topologyManager.getConnectedPeerCount()}\n`);

  return topologyManager;
}

// =============================================================================
// TOPOLOGY DISCOVERY
// =============================================================================

/**
 * Example 2: Discover Network Topology
 * Query the mesh to build a complete connectivity map
 */
async function discoverTopology(topologyManager) {
  console.log('=== Example 2: Discover Topology ===\n');

  try {
    // Start discovery
    console.log('Starting topology discovery...');
    const topology = await topologyManager.discoverTopology(10000);

    // Display results
    console.log('\nTopology Discovery Complete:');
    console.log(`  Total nodes: ${topology.totalNodes}`);
    console.log(`  Total edges: ${topology.totalEdges}`);
    console.log(`  Our role: ${topology.self.role}`);
    console.log(`  Our connections: ${topology.self.connections.length}`);

    console.log('\nKnown peers:');
    for (const peer of topology.knownPeers) {
      console.log(`  - ${peer.displayName} (${peer.peerId.substring(0, 8)})`);
      console.log(`    Role: ${peer.role}, Connections: ${peer.connectionCount}`);
      console.log(`    Age: ${Math.round(peer.age / 1000)}s`);
    }

    return topology;
  } catch (error) {
    console.error('Topology discovery failed:', error);
    throw error;
  }
}

// =============================================================================
// PATH FINDING
// =============================================================================

/**
 * Example 3: Find Paths to Peer
 * Use BFS to find multiple paths to a target peer
 */
async function findPathsToPeer(topologyManager, targetPeerId) {
  console.log(`\n=== Example 3: Find Paths to ${targetPeerId.substring(0, 8)} ===\n`);

  // Find up to 3 paths
  const paths = topologyManager.findPathsToPeer(targetPeerId, 3);

  if (paths.length === 0) {
    console.log('✗ No paths found to target peer');
    return [];
  }

  console.log(`Found ${paths.length} path(s):\n`);

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const hopCount = path.length - 1;

    console.log(`Path ${i + 1} (${hopCount} hops):`);
    console.log(`  ${path.map(id => id.substring(0, 8)).join(' → ')}`);
  }

  return paths;
}

// =============================================================================
// RELAY SELECTION
// =============================================================================

/**
 * Example 4: Find Best Relay for Reconnection
 * Identify peers that can relay to a disconnected target
 */
async function findBestRelay(topologyManager, targetPeerId) {
  console.log(`\n=== Example 4: Find Best Relay for ${targetPeerId.substring(0, 8)} ===\n`);

  // Find all potential relays
  const relays = topologyManager.findPotentialRelays(targetPeerId);

  if (relays.length === 0) {
    console.log('✗ No relays available for target peer');
    return null;
  }

  console.log(`Found ${relays.length} potential relay(s):\n`);

  for (const relay of relays) {
    console.log(`  ${relay.displayName} (${relay.peerId.substring(0, 8)})`);
    console.log(`    Quality: ${relay.quality}/100`);
    console.log(`    Hop count: ${relay.hopCount}`);
  }

  // Get the best relay
  const bestRelay = topologyManager.getBestRelayForTarget(targetPeerId);

  if (bestRelay) {
    const relayInfo = relays.find(r => r.peerId === bestRelay);
    console.log(`\n✓ Best relay: ${relayInfo.displayName} (quality: ${relayInfo.quality})`);
  }

  return bestRelay;
}

// =============================================================================
// AUTOMATIC RECONNECTION WITH TOPOLOGY
// =============================================================================

/**
 * Example 5: Automatic Reconnection Using Topology
 * Use topology data to intelligently reconnect to a peer
 */
async function reconnectWithTopology(topologyManager, targetPeerId) {
  console.log(`\n=== Example 5: Reconnect to ${targetPeerId.substring(0, 8)} ===\n`);

  // Step 1: Discover current topology
  console.log('Step 1: Discovering topology...');
  await topologyManager.discoverTopology(5000);

  // Step 2: Find paths to target
  console.log('\nStep 2: Finding paths to target...');
  const paths = topologyManager.findPathsToPeer(targetPeerId, 3);

  if (paths.length === 0) {
    console.log('✗ Target is not reachable through mesh');
    return false;
  }

  console.log(`✓ Found ${paths.length} path(s) to target`);

  // Step 3: Find best relay
  console.log('\nStep 3: Selecting best relay...');
  const relayId = topologyManager.getBestRelayForTarget(targetPeerId);

  if (!relayId) {
    console.log('✗ No relay available');
    return false;
  }

  console.log(`✓ Selected relay: ${relayId.substring(0, 8)}`);

  // Step 4: Initiate reconnection through relay
  console.log('\nStep 4: Initiating reconnection through relay...');

  // Use your relay reconnection module here
  // await relayReconnection.initiateReconnection(targetPeerId, relayId);

  console.log('✓ Reconnection request sent through relay');

  return true;
}

// =============================================================================
// PERIODIC TOPOLOGY MONITORING
// =============================================================================

/**
 * Example 6: Periodic Topology Monitoring
 * Continuously monitor mesh topology for network changes
 */
async function startTopologyMonitoring(topologyManager) {
  console.log('\n=== Example 6: Periodic Topology Monitoring ===\n');

  // Start periodic discovery (every 60 seconds)
  topologyManager.startTopologyDiscovery(60000);

  console.log('✓ Periodic topology discovery started (60s interval)');

  // Monitor topology changes
  setInterval(() => {
    const stats = topologyManager.getStats();
    const view = topologyManager.getTopologyView();

    console.log('\nTopology Update:');
    console.log(`  Time: ${new Date().toLocaleTimeString()}`);
    console.log(`  Known peers: ${stats.knownPeers}`);
    console.log(`  Total nodes: ${stats.totalNodes}`);
    console.log(`  Total edges: ${stats.totalEdges}`);
    console.log(`  Our role: ${stats.ourRole}`);
    console.log(`  Our connections: ${stats.ourConnections}`);
    console.log(`  Requests sent: ${stats.requestsSent}`);
    console.log(`  Responses received: ${stats.responsesReceived}`);
  }, 60000);

  // To stop monitoring later:
  // topologyManager.stopTopologyDiscovery();
}

// =============================================================================
// MESH HEALTH MONITORING
// =============================================================================

/**
 * Example 7: Mesh Health Monitoring
 * Analyze topology to assess mesh health and connectivity
 */
async function monitorMeshHealth(topologyManager) {
  console.log('\n=== Example 7: Mesh Health Monitoring ===\n');

  // Discover topology
  const topology = await topologyManager.discoverTopology();
  const stats = topologyManager.getStats();

  // Calculate health metrics
  const avgConnections = topology.totalEdges / topology.totalNodes;
  const hubCount = topology.knownPeers.filter(p => p.role === 'hub').length;
  const relayCount = topology.knownPeers.filter(p => p.role === 'relay').length;
  const leafCount = topology.knownPeers.filter(p => p.role === 'leaf').length;
  const isolatedCount = topology.knownPeers.filter(p => p.role === 'isolated').length;

  // Assess mesh health
  console.log('Mesh Health Report:');
  console.log(`  Total nodes: ${topology.totalNodes}`);
  console.log(`  Total edges: ${topology.totalEdges}`);
  console.log(`  Avg connections per node: ${avgConnections.toFixed(2)}`);
  console.log(`  Network diameter: ~${Math.ceil(Math.log2(topology.totalNodes))}`);

  console.log('\nRole Distribution:');
  console.log(`  Hubs (5+ connections): ${hubCount}`);
  console.log(`  Relays (3-4 connections): ${relayCount}`);
  console.log(`  Leaves (1-2 connections): ${leafCount}`);
  console.log(`  Isolated (0 connections): ${isolatedCount}`);

  // Health score (0-100)
  let healthScore = 50;

  // Good average connectivity
  if (avgConnections >= 3) healthScore += 20;
  else if (avgConnections >= 2) healthScore += 10;

  // Presence of hubs
  if (hubCount > 0) healthScore += 15;

  // Low isolation rate
  const isolationRate = isolatedCount / topology.totalNodes;
  if (isolationRate < 0.1) healthScore += 15;
  else if (isolationRate < 0.3) healthScore += 5;

  console.log(`\nHealth Score: ${healthScore}/100`);

  if (healthScore >= 80) {
    console.log('Status: ✓ Excellent mesh connectivity');
  } else if (healthScore >= 60) {
    console.log('Status: ✓ Good mesh connectivity');
  } else if (healthScore >= 40) {
    console.log('Status: ⚠ Fair mesh connectivity');
  } else {
    console.log('Status: ✗ Poor mesh connectivity');
  }

  return {
    healthScore,
    avgConnections,
    roleDistribution: { hubCount, relayCount, leafCount, isolatedCount },
  };
}

// =============================================================================
// NETWORK VISUALIZATION DATA
// =============================================================================

/**
 * Example 8: Generate Data for Network Visualization
 * Export topology in format suitable for D3.js or similar
 */
async function generateVisualizationData(topologyManager) {
  console.log('\n=== Example 8: Generate Visualization Data ===\n');

  const topology = await topologyManager.discoverTopology();

  // Build nodes array
  const nodes = [
    {
      id: topology.self.peerId,
      label: topology.self.displayName,
      role: topology.self.role,
      isSelf: true,
    },
  ];

  // Build edges array
  const edges = [];
  const edgeSet = new Set(); // Prevent duplicates

  // Add self connections
  for (const connId of topology.self.connections) {
    const edgeId = [topology.self.peerId, connId].sort().join('-');
    if (!edgeSet.has(edgeId)) {
      edges.push({
        source: topology.self.peerId,
        target: connId,
      });
      edgeSet.add(edgeId);
    }
  }

  // Add other peers
  for (const peer of topology.knownPeers) {
    nodes.push({
      id: peer.peerId,
      label: peer.displayName,
      role: peer.role,
      isSelf: false,
    });

    // Add peer connections
    for (const connId of peer.connections) {
      const edgeId = [peer.peerId, connId].sort().join('-');
      if (!edgeSet.has(edgeId)) {
        edges.push({
          source: peer.peerId,
          target: connId,
        });
        edgeSet.add(edgeId);
      }
    }
  }

  const graphData = { nodes, edges };

  console.log('Graph data generated:');
  console.log(`  Nodes: ${nodes.length}`);
  console.log(`  Edges: ${edges.length}`);

  // Example: Save to file or send to visualization component
  // localStorage.setItem('mesh-topology', JSON.stringify(graphData));

  return graphData;
}

// =============================================================================
// COMPLETE INTEGRATION EXAMPLE
// =============================================================================

/**
 * Example 9: Complete Integration in Mesh Application
 * Full lifecycle: setup, discovery, monitoring, and reconnection
 */
async function completeIntegrationExample() {
  console.log('\n' + '='.repeat(60));
  console.log('COMPLETE MESH TOPOLOGY INTEGRATION EXAMPLE');
  console.log('='.repeat(60) + '\n');

  try {
    // 1. Setup
    const topologyManager = await basicSetup();

    // 2. Initial discovery
    await discoverTopology(topologyManager);

    // 3. Start monitoring
    await startTopologyMonitoring(topologyManager);

    // 4. Example: Find paths to a specific peer
    const targetPeerId = 'peer-xyz-789';
    await findPathsToPeer(topologyManager, targetPeerId);

    // 5. Example: Find relay for reconnection
    await findBestRelay(topologyManager, targetPeerId);

    // 6. Example: Perform reconnection
    await reconnectWithTopology(topologyManager, targetPeerId);

    // 7. Monitor mesh health
    await monitorMeshHealth(topologyManager);

    // 8. Generate visualization data
    await generateVisualizationData(topologyManager);

    console.log('\n' + '='.repeat(60));
    console.log('✓ Integration complete!');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('Integration failed:', error);
  }
}

// =============================================================================
// INTEGRATION WITH UI
// =============================================================================

/**
 * Example 10: Integration with React/Vue UI
 * Show how to use topology data in UI components
 */
function uiIntegrationExample() {
  console.log('\n=== Example 10: UI Integration ===\n');

  // Example React component
  console.log('Example React Component:\n');
  console.log(`
import React, { useState, useEffect } from 'react';
import MeshTopologyManager from './topology-discovery';

function NetworkTopologyView({ topologyManager }) {
  const [topology, setTopology] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    // Initial discovery
    const discover = async () => {
      const topo = await topologyManager.discoverTopology();
      const stats = topologyManager.getStats();
      setTopology(topo);
      setStats(stats);
    };

    discover();

    // Periodic updates
    const interval = setInterval(discover, 60000);
    return () => clearInterval(interval);
  }, [topologyManager]);

  if (!topology) return <div>Discovering network...</div>;

  return (
    <div className="topology-view">
      <h2>Network Topology</h2>

      <div className="stats">
        <div>Nodes: {topology.totalNodes}</div>
        <div>Edges: {topology.totalEdges}</div>
        <div>Your Role: {topology.self.role}</div>
        <div>Connections: {topology.self.connections.length}</div>
      </div>

      <div className="peers">
        <h3>Known Peers</h3>
        {topology.knownPeers.map(peer => (
          <div key={peer.peerId} className="peer-card">
            <strong>{peer.displayName}</strong>
            <span>Role: {peer.role}</span>
            <span>Connections: {peer.connectionCount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default NetworkTopologyView;
  `);

  console.log('\n✓ See above for React component example');
}

// =============================================================================
// RUN EXAMPLES
// =============================================================================

// Run all examples
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    console.log('\n' + '='.repeat(60));
    console.log('MESH TOPOLOGY MANAGER - INTEGRATION EXAMPLES');
    console.log('='.repeat(60) + '\n');

    // Run complete integration example
    await completeIntegrationExample();

    // Show UI integration
    uiIntegrationExample();

    console.log('\nExamples complete! Check the output above for integration patterns.\n');
  })();
}

// Export examples for use in other files
export {
  basicSetup,
  discoverTopology,
  findPathsToPeer,
  findBestRelay,
  reconnectWithTopology,
  startTopologyMonitoring,
  monitorMeshHealth,
  generateVisualizationData,
  completeIntegrationExample,
  uiIntegrationExample,
};
