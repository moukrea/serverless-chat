/**
 * Condition-based wait helpers for E2E tests.
 * These helpers replace fixed waitForTimeout() calls with condition-based waits
 * that are faster and more reliable.
 */

/**
 * Generic condition-based wait with polling.
 *
 * @param {Page} page - Playwright page object
 * @param {Function} condition - Async function that returns true when condition is met
 * @param {Object} options - Configuration options
 * @param {number} options.timeout - Maximum time to wait in ms (default: 10000)
 * @param {number} options.interval - Polling interval in ms (default: 100)
 * @param {string} options.timeoutMessage - Custom error message on timeout
 * @returns {Promise<void>}
 * @throws {Error} When timeout is reached
 */
export async function waitForCondition(page, condition, options = {}) {
  const {
    timeout = 10000,
    interval = 100,
    timeoutMessage = 'Condition not met within timeout'
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const result = await condition();
      if (result) {
        return;
      }
    } catch (error) {
      // Condition threw an error, continue polling
    }

    await page.waitForTimeout(interval);
  }

  throw new Error(`${timeoutMessage} (waited ${timeout}ms)`);
}

/**
 * Wait for a stable connection to a specific peer.
 * Connection is considered stable when it remains connected for a minimum duration.
 *
 * @param {Page} page - Playwright page object
 * @param {string} peerId - UUID of the peer to wait for
 * @param {number} minStabilityTime - Minimum time in ms the connection must remain stable (default: 1000)
 * @param {number} timeout - Maximum time to wait in ms (default: 15000)
 * @returns {Promise<void>}
 */
export async function waitForStableConnection(page, peerId, minStabilityTime = 1000, timeout = 15000) {
  let stableStartTime = null;

  await waitForCondition(
    page,
    async () => {
      const isConnected = await page.evaluate((id) => {
        const mesh = window.mesh;
        if (!mesh || !mesh.peers) return false;

        const peer = mesh.peers.get(id);
        return peer && peer.status === 'connected';
      }, peerId);

      if (isConnected) {
        if (stableStartTime === null) {
          stableStartTime = Date.now();
        }
        return Date.now() - stableStartTime >= minStabilityTime;
      } else {
        stableStartTime = null;
        return false;
      }
    },
    {
      timeout,
      interval: 100,
      timeoutMessage: `Peer ${peerId} did not achieve stable connection for ${minStabilityTime}ms`
    }
  );
}

/**
 * Wait for peer data to be persisted to localStorage.
 * Checks that peer information is written to storage and remains stable.
 *
 * @param {Page} page - Playwright page object
 * @param {string} peerId - UUID of the peer to check for
 * @param {number} stabilityTime - Time to wait after detection to ensure persistence (default: 500)
 * @param {number} timeout - Maximum time to wait in ms (default: 10000)
 * @returns {Promise<void>}
 */
export async function waitForPeerPersisted(page, peerId, stabilityTime = 500, timeout = 10000) {
  // First, wait for the peer to be in localStorage
  await waitForCondition(
    page,
    async () => {
      return await page.evaluate((id) => {
        const indexData = localStorage.getItem('mesh:peers:index');
        if (!indexData) return false;

        const index = JSON.parse(indexData);
        return index.includes(id);
      }, peerId);
    },
    {
      timeout,
      interval: 100,
      timeoutMessage: `Peer ${peerId} was not persisted to localStorage`
    }
  );

  // Wait for stability to ensure persistence is complete
  await page.waitForTimeout(stabilityTime);

  // Verify it's still there after stability period
  const stillPresent = await page.evaluate((id) => {
    const indexData = localStorage.getItem('mesh:peers:index');
    if (!indexData) return false;

    const index = JSON.parse(indexData);
    const peerKey = `mesh:peer:${id}`;
    const peerData = localStorage.getItem(peerKey);

    return index.includes(id) && peerData !== null;
  }, peerId);

  if (!stillPresent) {
    throw new Error(`Peer ${peerId} persistence was not stable`);
  }
}

/**
 * Wait for the mesh network to be ready and stable.
 * Checks that mesh is initialized, has expected peer count, and all connections are stable.
 *
 * @param {Page} page - Playwright page object
 * @param {number} expectedPeerCount - Expected number of peers (default: 1)
 * @param {number} stabilityTime - Time connections must remain stable in ms (default: 1000)
 * @param {number} timeout - Maximum time to wait in ms (default: 30000)
 * @returns {Promise<void>}
 */
export async function waitForMeshReady(page, expectedPeerCount = 1, stabilityTime = 1000, timeout = 30000) {
  let stableStartTime = null;

  await waitForCondition(
    page,
    async () => {
      const meshState = await page.evaluate((count) => {
        const mesh = window.mesh;
        if (!mesh || !mesh.peers) return { ready: false, peerCount: 0 };

        const peerCount = mesh.peers.size;
        if (peerCount < count) return { ready: false, peerCount };

        // Check that all peers are connected
        let allConnected = true;
        for (const [_, peerData] of mesh.peers.entries()) {
          if (peerData.status !== 'connected') {
            allConnected = false;
            break;
          }
        }

        return { ready: allConnected && peerCount >= count, peerCount };
      }, expectedPeerCount);

      if (meshState.ready) {
        if (stableStartTime === null) {
          stableStartTime = Date.now();
        }
        return Date.now() - stableStartTime >= stabilityTime;
      } else {
        stableStartTime = null;
        return false;
      }
    },
    {
      timeout,
      interval: 100,
      timeoutMessage: `Mesh did not reach ready state with ${expectedPeerCount} peer(s) within ${timeout}ms`
    }
  );
}

/**
 * Wait for mesh to reach a specific connection state.
 *
 * @param {Page} page - Playwright page object
 * @param {string} expectedState - Expected state: 'initialized', 'connecting', 'connected', 'disconnected'
 * @param {number} timeout - Maximum time to wait in ms (default: 10000)
 * @returns {Promise<void>}
 */
export async function waitForConnectionState(page, expectedState, timeout = 10000) {
  await waitForCondition(
    page,
    async () => {
      return await page.evaluate((state) => {
        const mesh = window.mesh;

        switch (state) {
          case 'initialized':
            return mesh && typeof mesh.createOffer === 'function';

          case 'connecting':
            return mesh && mesh.peers && mesh.peers.size > 0 &&
              Array.from(mesh.peers.values()).some(p => p.status === 'connecting');

          case 'connected':
            return mesh && mesh.peers && mesh.peers.size > 0 &&
              Array.from(mesh.peers.values()).every(p => p.status === 'connected');

          case 'disconnected':
            return !mesh || !mesh.peers || mesh.peers.size === 0;

          default:
            return false;
        }
      }, expectedState);
    },
    {
      timeout,
      interval: 100,
      timeoutMessage: `Connection state did not reach '${expectedState}' within ${timeout}ms`
    }
  );
}

/**
 * Wait for the page to reach a stable state.
 * Useful after UI interactions to ensure the page has finished updating.
 *
 * @param {Page} page - Playwright page object
 * @param {number} stabilityTime - Time with no DOM changes to consider stable (default: 500)
 * @param {number} timeout - Maximum time to wait in ms (default: 5000)
 * @returns {Promise<void>}
 */
export async function waitForPageStable(page, stabilityTime = 500, timeout = 5000) {
  await page.evaluate((stability) => {
    return new Promise((resolve) => {
      let lastChange = Date.now();
      let checkInterval;

      const observer = new MutationObserver(() => {
        lastChange = Date.now();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });

      checkInterval = setInterval(() => {
        if (Date.now() - lastChange >= stability) {
          observer.disconnect();
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }, stabilityTime);
}

/**
 * Wait for a UI element to appear and stabilize.
 * Ensures the element is visible and remains in the DOM.
 *
 * @param {Page} page - Playwright page object
 * @param {string} selector - CSS selector for the element
 * @param {number} stabilityTime - Time element must remain visible (default: 300)
 * @param {number} timeout - Maximum time to wait in ms (default: 10000)
 * @returns {Promise<void>}
 */
export async function waitForElementStable(page, selector, stabilityTime = 300, timeout = 10000) {
  // First wait for element to be visible
  await page.waitForSelector(selector, { state: 'visible', timeout });

  // Then ensure it remains visible and stable
  let stableStartTime = null;

  await waitForCondition(
    page,
    async () => {
      const isVisible = await page.isVisible(selector);

      if (isVisible) {
        if (stableStartTime === null) {
          stableStartTime = Date.now();
        }
        return Date.now() - stableStartTime >= stabilityTime;
      } else {
        stableStartTime = null;
        return false;
      }
    },
    {
      timeout: timeout - 1000, // Account for initial wait
      interval: 50,
      timeoutMessage: `Element ${selector} did not stabilize within ${timeout}ms`
    }
  );
}

/**
 * Wait for display name to propagate across peers.
 * Ensures the display name change is visible in the peer list.
 *
 * @param {Page} page - Playwright page object to check
 * @param {string} expectedName - The display name to wait for
 * @param {string} peerUuid - UUID of the peer whose name changed (optional)
 * @param {number} timeout - Maximum time to wait in ms (default: 5000)
 * @returns {Promise<void>}
 */
export async function waitForDisplayNamePropagation(page, expectedName, peerUuid = null, timeout = 5000) {
  await waitForCondition(
    page,
    async () => {
      return await page.evaluate((args) => {
        const { name, uuid } = args;
        const peerItems = document.querySelectorAll('.peer-item');

        for (const item of peerItems) {
          if (uuid) {
            // Check specific peer
            if (item.getAttribute('data-uuid') === uuid) {
              const nameElement = item.querySelector('.peer-name');
              return nameElement && nameElement.textContent.includes(name);
            }
          } else {
            // Check any peer
            const nameElement = item.querySelector('.peer-name');
            if (nameElement && nameElement.textContent.includes(name)) {
              return true;
            }
          }
        }
        return false;
      }, { name: expectedName, uuid: peerUuid });
    },
    {
      timeout,
      interval: 100,
      timeoutMessage: `Display name '${expectedName}' did not propagate within ${timeout}ms`
    }
  );
}

/**
 * Wait for mesh topology to stabilize after peer addition.
 * In a mesh network, when a new peer joins, it needs time to establish
 * connections with all existing peers.
 *
 * @param {Page} page - Playwright page object
 * @param {number} expectedPeerCount - Expected number of peers in the mesh
 * @param {number} stabilityTime - Time the mesh must remain stable (default: 2000)
 * @param {number} timeout - Maximum time to wait in ms (default: 40000)
 * @returns {Promise<void>}
 */
export async function waitForMeshTopologyStable(page, expectedPeerCount, stabilityTime = 2000, timeout = 40000) {
  let stableStartTime = null;
  let lastPeerCount = 0;

  await waitForCondition(
    page,
    async () => {
      const meshState = await page.evaluate((expected) => {
        const mesh = window.mesh;
        if (!mesh || !mesh.peers) return { peerCount: 0, allConnected: false };

        const peerCount = mesh.peers.size;
        const allConnected = peerCount >= expected &&
          Array.from(mesh.peers.values()).every(p => p.status === 'connected');

        return { peerCount, allConnected };
      }, expectedPeerCount);

      if (meshState.allConnected && meshState.peerCount >= expectedPeerCount) {
        if (meshState.peerCount !== lastPeerCount) {
          // Peer count changed, reset stability timer
          lastPeerCount = meshState.peerCount;
          stableStartTime = Date.now();
          return false;
        }

        if (stableStartTime === null) {
          stableStartTime = Date.now();
        }

        return Date.now() - stableStartTime >= stabilityTime;
      } else {
        stableStartTime = null;
        lastPeerCount = meshState.peerCount;
        return false;
      }
    },
    {
      timeout,
      interval: 200,
      timeoutMessage: `Mesh topology did not stabilize with ${expectedPeerCount} peers within ${timeout}ms`
    }
  );
}

/**
 * Wait for reconnection after a peer refresh.
 * Handles the full reconnection cycle including persistence checks.
 *
 * @param {Page} page - Playwright page object
 * @param {number} minPeerCount - Minimum number of peers to reconnect to (default: 1)
 * @param {number} timeout - Maximum time to wait in ms (default: 45000)
 * @returns {Promise<void>}
 */
export async function waitForReconnectionComplete(page, minPeerCount = 1, timeout = 45000) {
  // First wait for mesh to initialize
  await waitForConnectionState(page, 'initialized', 10000);

  // Then wait for peers to reconnect
  await waitForMeshReady(page, minPeerCount, 1500, timeout);

  // Verify persistence data exists
  const hasPersistence = await page.evaluate(() => {
    const indexData = localStorage.getItem('mesh:peers:index');
    return indexData !== null && JSON.parse(indexData).length > 0;
  });

  if (!hasPersistence) {
    throw new Error('Reconnection completed but persistence data is missing');
  }
}

/**
 * Wait for an edit dialog or modal to appear and be ready for input.
 *
 * @param {Page} page - Playwright page object
 * @param {number} timeout - Maximum time to wait in ms (default: 2000)
 * @returns {Promise<void>}
 */
export async function waitForEditDialogReady(page, timeout = 2000) {
  await waitForCondition(
    page,
    async () => {
      return await page.evaluate(() => {
        // Check for prompt dialog
        const input = document.querySelector('input[type="text"]');
        if (input && input.offsetParent !== null) {
          return true;
        }
        return false;
      });
    },
    {
      timeout,
      interval: 50,
      timeoutMessage: 'Edit dialog did not become ready for input'
    }
  );
}
