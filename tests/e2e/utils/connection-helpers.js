export async function waitForPeerConnection(page, timeout = 30000) {
  await page.waitForFunction(
    () => {
      const mesh = window.mesh;
      return mesh && mesh.peers && mesh.peers.size > 0;
    },
    { timeout }
  );
}

export async function waitForPeerCount(page, expectedCount, timeout = 30000) {
  await page.waitForFunction(
    (count) => {
      const mesh = window.mesh;
      return mesh && mesh.peers && mesh.peers.size >= count;
    },
    expectedCount,
    { timeout }
  );
}

export async function getConnectedPeerCount(page) {
  return await page.evaluate(() => {
    const mesh = window.mesh;
    return mesh && mesh.peers ? mesh.peers.size : 0;
  });
}

export async function getConnectedPeers(page) {
  return await page.evaluate(() => {
    const mesh = window.mesh;
    if (!mesh || !mesh.peers) return [];

    const peers = [];
    for (const [uuid, peerData] of mesh.peers.entries()) {
      peers.push({
        uuid,
        displayName: peerData.displayName,
        status: peerData.status,
        latency: peerData.latency
      });
    }
    return peers;
  });
}

export async function getPeerUUID(page) {
  return await page.evaluate(() => {
    const identity = window.identity;
    return identity ? identity.uuid : null;
  });
}

export async function getDisplayName(page) {
  return await page.evaluate(() => {
    const identity = window.identity;
    return identity ? identity.displayName : null;
  });
}

export async function waitForMeshInitialization(page, timeout = 10000) {
  await page.waitForFunction(
    () => {
      return window.mesh && typeof window.mesh.createOffer === 'function';
    },
    { timeout }
  );
}

export async function createOfferOnPage(page) {
  await waitForMeshInitialization(page);
  return await page.evaluate(async () => {
    return await window.mesh.createOffer();
  });
}

export async function acceptOfferOnPage(page, offer) {
  await waitForMeshInitialization(page);
  return await page.evaluate(async (offerData) => {
    return await window.mesh.acceptOffer(offerData);
  }, offer);
}

export async function acceptAnswerOnPage(page, answer) {
  await waitForMeshInitialization(page);
  await page.evaluate(async (answerData) => {
    await window.mesh.acceptAnswer(answerData);
  }, answer);
}

export async function manualPeerConnection(pageA, pageB) {
  const offer = await createOfferOnPage(pageA);
  const answer = await acceptOfferOnPage(pageB, offer);
  await acceptAnswerOnPage(pageA, answer);

  await Promise.all([
    waitForPeerConnection(pageA),
    waitForPeerConnection(pageB)
  ]);
}

/**
 * Setup reconnection tracking before page reload
 * Captures state needed to verify actual reconnection occurred
 *
 * @param {Page} page - Playwright page instance
 * @returns {Promise<Object>} State before reconnection with:
 *   - connectedPeerUUIDs: Array of UUIDs that were connected
 *   - reconnectionStats: Reconnection system stats before reload
 *   - persistedPeerCount: Number of peers in localStorage
 *   - timestamp: When state was captured
 */
export async function setupReconnectionTracking(page) {
  return await page.evaluate(() => {
    const beforeState = {
      timestamp: Date.now(),
      connectedPeerUUIDs: [],
      reconnectionStats: null,
      persistedPeerCount: 0,
      meshInitialized: false
    };

    // Capture connected peer UUIDs
    if (window.mesh && window.mesh.peers) {
      beforeState.meshInitialized = true;
      for (const [uuid, peerData] of window.mesh.peers.entries()) {
        if (peerData.status === 'connected' && uuid !== '_temp') {
          beforeState.connectedPeerUUIDs.push(uuid);
        }
      }
    }

    // Capture reconnection stats
    if (window.mesh && window.mesh.getReconnectionStats) {
      const stats = window.mesh.getReconnectionStats();
      if (stats && stats.master) {
        beforeState.reconnectionStats = {
          totalAttempts: stats.master.totalReconnectionAttempts || 0,
          successful: stats.master.successfulReconnections || 0,
          failed: stats.master.failedReconnections || 0
        };
      }
    }

    // Count persisted peers in localStorage
    const peersIndex = localStorage.getItem('mesh:peers:index');
    if (peersIndex) {
      try {
        const peerIds = JSON.parse(peersIndex);
        beforeState.persistedPeerCount = peerIds.length;
      } catch (e) {
        beforeState.persistedPeerCount = 0;
      }
    }

    return beforeState;
  });
}

/**
 * Wait for actual reconnection to occur and verify it happened correctly
 *
 * This function verifies that reconnection actually occurred by checking:
 * 1. Reconnection code executed (stats.totalAttempts increased)
 * 2. localStorage was loaded (persistence data exists)
 * 3. Same peer UUID reconnected (not fresh connection)
 * 4. Reconnection method was used (not fallback)
 * 5. Connection is stable
 *
 * @param {Page} page - Playwright page instance
 * @param {Object} beforeState - State captured by setupReconnectionTracking()
 * @param {Object} options - Verification options
 * @param {number} options.timeout - Maximum time to wait (default 40000ms)
 * @param {boolean} options.allowPartialReconnection - Allow fewer peers than before (default true)
 * @param {boolean} options.requireSamePeers - Require exact same peer UUIDs (default true)
 * @param {number} options.stabilityCheckMs - How long to verify connection is stable (default 2000ms)
 * @returns {Promise<Object>} Verification result with details
 *
 * @throws {Error} If reconnection verification fails
 */
export async function waitForActualReconnection(page, beforeState, options = {}) {
  const {
    timeout = 40000,
    allowPartialReconnection = true,
    requireSamePeers = true,
    stabilityCheckMs = 2000
  } = options;

  const startTime = Date.now();

  // Step 1: Wait for mesh to be initialized
  await page.waitForFunction(
    () => {
      return window.mesh &&
             window.mesh.reconnectionReady &&
             typeof window.mesh.getReconnectionStats === 'function';
    },
    { timeout: Math.min(10000, timeout) }
  );

  // Step 2: Wait for reconnection to complete (peers connected OR fallback triggered)
  const reconnectionResult = await page.waitForFunction(
    (beforeStats) => {
      const mesh = window.mesh;
      if (!mesh || !mesh.getReconnectionStats) return false;

      const stats = mesh.getReconnectionStats();
      if (!stats || !stats.master) return false;

      const currentAttempts = stats.master.totalReconnectionAttempts || 0;
      const beforeAttempts = beforeStats?.totalAttempts || 0;

      // Reconnection attempted (stats increased)
      const attemptMade = currentAttempts > beforeAttempts;

      // Either we have peers or reconnection completed
      const hasResult = mesh.peers && mesh.peers.size > 0;
      const lastResult = mesh.masterReconnect?.lastReconnectionResult;
      const reconnectionCompleted = lastResult && lastResult.duration !== undefined;

      return attemptMade && (hasResult || reconnectionCompleted);
    },
    beforeState.reconnectionStats,
    { timeout: timeout - (Date.now() - startTime) }
  );

  // Step 3: Verify reconnection success
  const verificationResult = await verifyReconnectionSuccess(page, beforeState, {
    allowPartialReconnection,
    requireSamePeers
  });

  // Step 4: Stability check - verify connection stays up
  if (verificationResult.success && stabilityCheckMs > 0) {
    await page.waitForTimeout(stabilityCheckMs);

    const stillConnected = await page.evaluate(() => {
      const mesh = window.mesh;
      return mesh && mesh.peers && mesh.peers.size > 0;
    });

    if (!stillConnected) {
      throw new Error('Reconnection unstable: peers disconnected during stability check');
    }
  }

  const totalDuration = Date.now() - startTime;
  return {
    ...verificationResult,
    duration: totalDuration
  };
}

/**
 * Verify that reconnection actually succeeded
 * Checks all reconnection indicators to ensure it was a real reconnection
 *
 * @param {Page} page - Playwright page instance
 * @param {Object} beforeState - State before reconnection
 * @param {Object} options - Verification options
 * @returns {Promise<Object>} Detailed verification result
 */
export async function verifyReconnectionSuccess(page, beforeState, options = {}) {
  const {
    allowPartialReconnection = true,
    requireSamePeers = true
  } = options;

  return await page.evaluate((before, opts) => {
    const result = {
      success: false,
      checks: {},
      errors: [],
      details: {}
    };

    const mesh = window.mesh;

    // Check 1: Mesh is initialized
    result.checks.meshInitialized = mesh && mesh.reconnectionReady === true;
    if (!result.checks.meshInitialized) {
      result.errors.push('Mesh not initialized or reconnection system not ready');
      return result;
    }

    // Check 2: Reconnection stats increased (proves reconnection code ran)
    const stats = mesh.getReconnectionStats();
    if (stats && stats.master) {
      const currentAttempts = stats.master.totalReconnectionAttempts || 0;
      const beforeAttempts = before.reconnectionStats?.totalAttempts || 0;
      result.checks.statsIncreased = currentAttempts > beforeAttempts;
      result.details.totalAttempts = currentAttempts;
      result.details.attemptsDelta = currentAttempts - beforeAttempts;

      if (!result.checks.statsIncreased) {
        result.errors.push(`Reconnection stats did not increase (before: ${beforeAttempts}, after: ${currentAttempts})`);
      }
    } else {
      result.checks.statsIncreased = false;
      result.errors.push('Reconnection stats not available');
    }

    // Check 3: localStorage persistence data exists
    const peersIndex = localStorage.getItem('mesh:peers:index');
    result.checks.persistenceExists = peersIndex !== null;
    if (result.checks.persistenceExists) {
      try {
        const peerIds = JSON.parse(peersIndex);
        result.details.persistedPeerCount = peerIds.length;
      } catch (e) {
        result.checks.persistenceExists = false;
        result.errors.push('Failed to parse localStorage peer index');
      }
    } else {
      result.errors.push('No persistence data in localStorage');
    }

    // Check 4: Peers are connected
    const connectedPeers = [];
    if (mesh.peers) {
      for (const [uuid, peerData] of mesh.peers.entries()) {
        if (peerData.status === 'connected' && uuid !== '_temp') {
          connectedPeers.push({
            uuid,
            displayName: peerData.displayName,
            connectedAt: peerData.connectedAt
          });
        }
      }
    }

    result.checks.hasPeers = connectedPeers.length > 0;
    result.details.connectedPeerCount = connectedPeers.length;
    result.details.connectedPeers = connectedPeers;

    if (!result.checks.hasPeers) {
      result.errors.push('No peers connected after reconnection');
    }

    // Check 5: Same peer UUIDs reconnected (not fresh connections)
    if (opts.requireSamePeers && before.connectedPeerUUIDs.length > 0) {
      const connectedUUIDs = connectedPeers.map(p => p.uuid);
      const sameUUIDs = before.connectedPeerUUIDs.filter(uuid =>
        connectedUUIDs.includes(uuid)
      );

      result.checks.samePeersReconnected = sameUUIDs.length > 0;
      result.details.samePeerCount = sameUUIDs.length;
      result.details.beforePeerUUIDs = before.connectedPeerUUIDs;
      result.details.afterPeerUUIDs = connectedUUIDs;
      result.details.matchingUUIDs = sameUUIDs;

      if (!result.checks.samePeersReconnected) {
        result.errors.push('No matching peer UUIDs - this appears to be a fresh connection, not reconnection');
      }

      // Check peer count expectations
      if (!opts.allowPartialReconnection && sameUUIDs.length < before.connectedPeerUUIDs.length) {
        result.errors.push(`Only ${sameUUIDs.length}/${before.connectedPeerUUIDs.length} peers reconnected`);
      }
    } else {
      result.checks.samePeersReconnected = true; // Skip this check if not required
    }

    // Check 6: Reconnection method was used (not fallback)
    const lastResult = mesh.masterReconnect?.lastReconnectionResult;
    if (lastResult) {
      result.details.reconnectionMethod = lastResult.method;
      result.details.reconnectionSuccess = lastResult.success;
      result.details.peersConnected = lastResult.peersConnected;

      // Verify it wasn't a fallback to manual pairing
      result.checks.usedReconnectionMethod =
        lastResult.method !== 'fallback_required' &&
        lastResult.method !== 'cold_start_failed' &&
        lastResult.success === true;

      if (!result.checks.usedReconnectionMethod) {
        result.errors.push(`Reconnection used fallback method: ${lastResult.method}`);
      }
    } else {
      result.checks.usedReconnectionMethod = false;
      result.errors.push('No reconnection result available');
    }

    // Overall success determination
    const requiredChecks = [
      'meshInitialized',
      'statsIncreased',
      'persistenceExists',
      'hasPeers',
      'samePeersReconnected',
      'usedReconnectionMethod'
    ];

    const passedChecks = requiredChecks.filter(check => result.checks[check] === true);
    result.success = passedChecks.length === requiredChecks.length;
    result.details.passedChecks = passedChecks.length;
    result.details.totalChecks = requiredChecks.length;

    return result;
  }, beforeState, options);
}

/**
 * Legacy waitForReconnection - maintained for backward compatibility
 *
 * @deprecated Use waitForActualReconnection() with setupReconnectionTracking() instead
 * This only checks that peers are connected, not that actual reconnection occurred
 */
export async function waitForReconnection(page, timeout = 40000) {
  await page.waitForFunction(
    () => {
      const mesh = window.mesh;
      return mesh && mesh.peers && mesh.peers.size > 0;
    },
    { timeout }
  );
}

export async function triggerReconnection(page) {
  await page.evaluate(async () => {
    if (window.mesh && window.mesh.reconnectToMesh) {
      return await window.mesh.reconnectToMesh();
    }
  });
}
