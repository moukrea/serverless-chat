/**
 * UUID Verification Helpers for E2E Tests
 *
 * This module provides utilities for capturing and verifying peer UUIDs
 * across reconnections, ensuring UUID stability and preventing regression
 * in the reconnection system.
 */

/**
 * Captures the current state of all connected peer UUIDs from a page.
 *
 * Returns a snapshot of the mesh network state including both the local
 * peer's UUID and all connected peer UUIDs. This snapshot can be used
 * to verify UUID stability after reconnections or page refreshes.
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @returns {Promise<Object>} Peer UUID state containing:
 *   - localUUID {string} - The local peer's UUID
 *   - peerUUIDs {string[]} - Array of connected peer UUIDs (sorted)
 *   - peerMap {Object.<string, Object>} - Map of UUID to peer data
 *   - timestamp {number} - Capture timestamp
 *
 * @example
 * const beforeState = await capturePeerUUIDs(page);
 * await page.reload();
 * await waitForReconnection(page);
 * await verifyPeerUUIDMatch(beforeState, page);
 */
export async function capturePeerUUIDs(page) {
  const state = await page.evaluate(() => {
    const mesh = window.mesh;
    const identity = window.identity;

    if (!mesh || !identity) {
      throw new Error('Mesh or identity not initialized');
    }

    const localUUID = identity.uuid;
    const peerUUIDs = [];
    const peerMap = {};

    if (mesh.peers) {
      for (const [uuid, peerData] of mesh.peers.entries()) {
        if (uuid !== '_temp' && peerData.status === 'connected') {
          peerUUIDs.push(uuid);
          peerMap[uuid] = {
            displayName: peerData.displayName,
            status: peerData.status,
            latency: peerData.latency,
            connectionType: peerData.connectionType
          };
        }
      }
    }

    peerUUIDs.sort();

    return {
      localUUID,
      peerUUIDs,
      peerMap,
      timestamp: Date.now()
    };
  });

  return state;
}

/**
 * Retrieves all connected peer UUIDs from the mesh network.
 *
 * This is a simpler alternative to capturePeerUUIDs when you only
 * need the list of UUIDs without additional metadata.
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @returns {Promise<string[]>} Array of connected peer UUIDs (sorted)
 *
 * @example
 * const peerUUIDs = await getConnectedPeerUUIDs(page);
 * expect(peerUUIDs).toHaveLength(2);
 */
export async function getConnectedPeerUUIDs(page) {
  return await page.evaluate(() => {
    const mesh = window.mesh;
    if (!mesh || !mesh.peers) {
      return [];
    }

    const uuids = [];
    for (const [uuid, peerData] of mesh.peers.entries()) {
      if (uuid !== '_temp' && peerData.status === 'connected') {
        uuids.push(uuid);
      }
    }

    return uuids.sort();
  });
}

/**
 * Checks if a specific peer UUID is present in the mesh network.
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} uuid - The UUID to check for
 * @returns {Promise<boolean>} True if the UUID is found in connected peers
 *
 * @throws {Error} If uuid parameter is not provided or invalid
 *
 * @example
 * const isConnected = await hasPeerUUID(page, peer2UUID);
 * expect(isConnected).toBe(true);
 */
export async function hasPeerUUID(page, uuid) {
  if (!uuid || typeof uuid !== 'string') {
    throw new Error('Valid UUID string required');
  }

  return await page.evaluate((targetUuid) => {
    const mesh = window.mesh;
    if (!mesh || !mesh.peers) {
      return false;
    }

    if (!mesh.peers.has(targetUuid)) {
      return false;
    }

    const peerData = mesh.peers.get(targetUuid);
    return peerData.status === 'connected';
  }, uuid);
}

/**
 * Waits for a specific peer UUID to appear in the mesh network.
 *
 * This helper will poll the mesh network until the specified UUID
 * is found and connected, or until the timeout is reached.
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} uuid - The UUID to wait for
 * @param {number} [timeout=30000] - Maximum time to wait in milliseconds
 * @returns {Promise<void>} Resolves when UUID is found, rejects on timeout
 *
 * @throws {Error} If uuid parameter is not provided or invalid
 * @throws {Error} If timeout is reached before UUID appears
 *
 * @example
 * await manualPeerConnection(page1, page2);
 * const peer2UUID = await getPeerUUID(page2);
 * await waitForPeerUUID(page1, peer2UUID);
 */
export async function waitForPeerUUID(page, uuid, timeout = 30000) {
  if (!uuid || typeof uuid !== 'string') {
    throw new Error('Valid UUID string required');
  }

  await page.waitForFunction(
    (targetUuid) => {
      const mesh = window.mesh;
      if (!mesh || !mesh.peers) {
        return false;
      }

      if (!mesh.peers.has(targetUuid)) {
        return false;
      }

      const peerData = mesh.peers.get(targetUuid);
      return peerData.status === 'connected';
    },
    uuid,
    { timeout }
  );
}

/**
 * Verifies that peer UUIDs match between a captured state and current state.
 *
 * This is the primary verification function for UUID stability tests.
 * It compares a previously captured state with the current mesh state
 * and validates that UUIDs remain consistent.
 *
 * Options:
 * - checkLocalUUID: Verify local peer's UUID hasn't changed (default: true)
 * - checkPeerCount: Verify same number of peers (default: true)
 * - allowSubset: Allow current state to have fewer peers (default: false)
 * - allowSuperset: Allow current state to have more peers (default: false)
 * - exactMatch: Require exact UUID set match (default: true)
 *
 * @param {Object} beforeState - State captured from capturePeerUUIDs()
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {Object} [options] - Verification options
 * @param {boolean} [options.checkLocalUUID=true] - Verify local UUID unchanged
 * @param {boolean} [options.checkPeerCount=true] - Verify peer count matches
 * @param {boolean} [options.allowSubset=false] - Allow fewer peers in current state
 * @param {boolean} [options.allowSuperset=false] - Allow more peers in current state
 * @param {boolean} [options.exactMatch=true] - Require exact UUID set match
 * @returns {Promise<Object>} Verification result with detailed comparison
 *
 * @throws {Error} If beforeState is invalid or missing required properties
 *
 * @example
 * // Strict verification (default)
 * const result = await verifyPeerUUIDMatch(beforeState, page);
 * expect(result.matches).toBe(true);
 *
 * @example
 * // Allow reconnection to partial mesh
 * const result = await verifyPeerUUIDMatch(beforeState, page, {
 *   allowSubset: true,
 *   checkPeerCount: false
 * });
 */
export async function verifyPeerUUIDMatch(beforeState, page, options = {}) {
  if (!beforeState || typeof beforeState !== 'object') {
    throw new Error('Invalid beforeState: must be object from capturePeerUUIDs()');
  }

  if (!beforeState.localUUID || !Array.isArray(beforeState.peerUUIDs)) {
    throw new Error('Invalid beforeState: missing localUUID or peerUUIDs');
  }

  const {
    checkLocalUUID = true,
    checkPeerCount = true,
    allowSubset = false,
    allowSuperset = false,
    exactMatch = true
  } = options;

  const afterState = await capturePeerUUIDs(page);

  const result = {
    matches: true,
    before: beforeState,
    after: afterState,
    details: {
      localUUIDMatch: null,
      peerCountMatch: null,
      uuidSetMatch: null,
      missingUUIDs: [],
      extraUUIDs: [],
      commonUUIDs: []
    }
  };

  if (checkLocalUUID) {
    result.details.localUUIDMatch = beforeState.localUUID === afterState.localUUID;
    if (!result.details.localUUIDMatch) {
      result.matches = false;
    }
  }

  const beforeSet = new Set(beforeState.peerUUIDs);
  const afterSet = new Set(afterState.peerUUIDs);

  result.details.missingUUIDs = beforeState.peerUUIDs.filter(uuid => !afterSet.has(uuid));
  result.details.extraUUIDs = afterState.peerUUIDs.filter(uuid => !beforeSet.has(uuid));
  result.details.commonUUIDs = beforeState.peerUUIDs.filter(uuid => afterSet.has(uuid));

  if (checkPeerCount) {
    result.details.peerCountMatch = beforeState.peerUUIDs.length === afterState.peerUUIDs.length;

    if (!allowSubset && !allowSuperset && !result.details.peerCountMatch) {
      result.matches = false;
    }
  }

  if (exactMatch && !allowSubset && !allowSuperset) {
    result.details.uuidSetMatch =
      result.details.missingUUIDs.length === 0 &&
      result.details.extraUUIDs.length === 0;

    if (!result.details.uuidSetMatch) {
      result.matches = false;
    }
  }

  if (allowSubset && !allowSuperset) {
    const isSubset = result.details.missingUUIDs.length === 0 ||
                     result.details.commonUUIDs.length > 0;
    result.details.uuidSetMatch = isSubset;

    if (result.details.extraUUIDs.length > 0) {
      result.matches = false;
    }
  }

  if (allowSuperset && !allowSubset) {
    const isSuperset = result.details.extraUUIDs.length === 0 ||
                       result.details.commonUUIDs.length > 0;
    result.details.uuidSetMatch = isSuperset;

    if (result.details.missingUUIDs.length > 0) {
      result.matches = false;
    }
  }

  if (allowSubset && allowSuperset) {
    result.details.uuidSetMatch = result.details.commonUUIDs.length > 0;
  }

  return result;
}

/**
 * Creates a human-readable summary of UUID verification results.
 *
 * Useful for debugging test failures by providing detailed information
 * about what changed between states.
 *
 * @param {Object} verificationResult - Result from verifyPeerUUIDMatch()
 * @returns {string} Formatted summary string
 *
 * @example
 * const result = await verifyPeerUUIDMatch(beforeState, page);
 * if (!result.matches) {
 *   console.log(formatVerificationResult(result));
 * }
 */
export function formatVerificationResult(verificationResult) {
  const { matches, before, after, details } = verificationResult;

  const lines = [
    `UUID Verification Result: ${matches ? 'PASS' : 'FAIL'}`,
    '',
    'Local UUID:',
    `  Before: ${before.localUUID}`,
    `  After:  ${after.localUUID}`,
    `  Match:  ${details.localUUIDMatch !== null ? (details.localUUIDMatch ? 'YES' : 'NO') : 'N/A'}`,
    '',
    'Peer Count:',
    `  Before: ${before.peerUUIDs.length}`,
    `  After:  ${after.peerUUIDs.length}`,
    `  Match:  ${details.peerCountMatch !== null ? (details.peerCountMatch ? 'YES' : 'NO') : 'N/A'}`,
    '',
    'UUID Sets:',
    `  Common:  ${details.commonUUIDs.length} peers`,
    `  Missing: ${details.missingUUIDs.length} peers ${details.missingUUIDs.length > 0 ? JSON.stringify(details.missingUUIDs.map(u => u.substring(0, 8))) : ''}`,
    `  Extra:   ${details.extraUUIDs.length} peers ${details.extraUUIDs.length > 0 ? JSON.stringify(details.extraUUIDs.map(u => u.substring(0, 8))) : ''}`,
    `  Match:   ${details.uuidSetMatch !== null ? (details.uuidSetMatch ? 'YES' : 'NO') : 'N/A'}`
  ];

  return lines.join('\n');
}

/**
 * Asserts that peer UUIDs match, throwing descriptive error on failure.
 *
 * This is a convenience wrapper around verifyPeerUUIDMatch that
 * automatically throws an error with detailed information if the
 * verification fails. Ideal for use in test assertions.
 *
 * @param {Object} beforeState - State captured from capturePeerUUIDs()
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {Object} [options] - Same options as verifyPeerUUIDMatch
 * @returns {Promise<Object>} Verification result (only if successful)
 *
 * @throws {Error} If UUID verification fails, with detailed summary
 *
 * @example
 * const beforeState = await capturePeerUUIDs(page);
 * await page.reload();
 * await waitForReconnection(page);
 * await assertPeerUUIDMatch(beforeState, page);
 */
export async function assertPeerUUIDMatch(beforeState, page, options = {}) {
  const result = await verifyPeerUUIDMatch(beforeState, page, options);

  if (!result.matches) {
    const summary = formatVerificationResult(result);
    throw new Error(`UUID verification failed:\n${summary}`);
  }

  return result;
}

/**
 * Captures UUID state from multiple pages simultaneously.
 *
 * Useful for multi-peer test scenarios where you need to capture
 * the state of an entire mesh network.
 *
 * @param {Array<import('@playwright/test').Page>} pages - Array of page instances
 * @returns {Promise<Array<Object>>} Array of captured states
 *
 * @example
 * const [state1, state2, state3] = await captureMultiplePeerStates([page1, page2, page3]);
 */
export async function captureMultiplePeerStates(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('Valid array of pages required');
  }

  return await Promise.all(pages.map(page => capturePeerUUIDs(page)));
}

/**
 * Verifies UUID cross-consistency between multiple peers.
 *
 * Ensures that each peer's view of the mesh network is consistent
 * with the others. For example, if peer A sees peer B with UUID X,
 * then peer B should identify itself with UUID X.
 *
 * @param {Array<Object>} states - Array of states from capturePeerUUIDs()
 * @returns {Object} Cross-consistency verification result
 *
 * @example
 * const states = await captureMultiplePeerStates([page1, page2, page3]);
 * const consistency = verifyCrossConsistency(states);
 * expect(consistency.isConsistent).toBe(true);
 */
export function verifyCrossConsistency(states) {
  if (!Array.isArray(states) || states.length < 2) {
    throw new Error('At least 2 peer states required for cross-consistency check');
  }

  const result = {
    isConsistent: true,
    totalPeers: states.length,
    issues: []
  };

  for (let i = 0; i < states.length; i++) {
    const peerState = states[i];
    const peerUUID = peerState.localUUID;

    for (let j = 0; j < states.length; j++) {
      if (i === j) continue;

      const otherState = states[j];

      if (otherState.peerUUIDs.includes(peerUUID)) {
        const peerData = otherState.peerMap[peerUUID];
        if (!peerData) {
          result.isConsistent = false;
          result.issues.push({
            type: 'missing_peer_data',
            peer: i,
            seenBy: j,
            uuid: peerUUID.substring(0, 8)
          });
        }
      }

      if (peerState.peerUUIDs.includes(otherState.localUUID)) {
        if (!otherState.peerUUIDs.includes(peerUUID)) {
          result.isConsistent = false;
          result.issues.push({
            type: 'asymmetric_connection',
            peer1: i,
            peer2: j,
            description: `Peer ${i} sees peer ${j}, but peer ${j} doesn't see peer ${i}`
          });
        }
      }
    }
  }

  return result;
}
