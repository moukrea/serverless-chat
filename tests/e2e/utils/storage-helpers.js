export async function getLocalStorage(page) {
  return await page.evaluate(() => {
    const storage = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      storage[key] = localStorage.getItem(key);
    }
    return storage;
  });
}

export async function setLocalStorage(page, storageData) {
  await page.evaluate((data) => {
    for (const [key, value] of Object.entries(data)) {
      localStorage.setItem(key, value);
    }
  }, storageData);
}

export async function clearLocalStorage(page) {
  await page.evaluate(() => {
    localStorage.clear();
  });
}

export async function injectLocalStorageBeforeLoad(context, storageData) {
  await context.addInitScript((data) => {
    for (const [key, value] of Object.entries(data)) {
      window.localStorage.setItem(key, value);
    }
  }, storageData);
}

export async function waitForLocalStorageKey(page, key, timeout = 10000) {
  await page.waitForFunction(
    (storageKey) => localStorage.getItem(storageKey) !== null,
    key,
    { timeout }
  );
}

export async function getLocalStorageKey(page, key) {
  return await page.evaluate((storageKey) => {
    return localStorage.getItem(storageKey);
  }, key);
}

export async function getPeerPersistenceData(page) {
  const indexData = await getLocalStorageKey(page, 'mesh:peers:index');
  const index = indexData ? JSON.parse(indexData) : [];

  const peers = {};
  for (const peerId of index) {
    const peerKey = `mesh:peer:${peerId}`;
    const peerData = await getLocalStorageKey(page, peerKey);
    if (peerData) {
      peers[peerId] = JSON.parse(peerData);
    }
  }

  return {
    index,
    peers,
    identity: await getLocalStorageKey(page, 'p2p_identity'),
    reconnectionIdentity: await getLocalStorageKey(page, 'mesh_reconnection_identity'),
    peerTrust: await getLocalStorageKey(page, 'mesh_peer_trust')
  };
}

/**
 * Wait for localStorage persistence of peer data with integrity verification
 * @param {Page} page - Playwright page instance
 * @param {number} timeout - Maximum wait time in milliseconds (default: 10000)
 * @returns {Promise<void>}
 * @throws {Error} If timeout is reached or persistence fails
 */
export async function waitForLocalStoragePersistence(page, timeout = 10000) {
  const startTime = Date.now();

  await page.waitForFunction(
    () => {
      const index = localStorage.getItem('mesh:peers:index');
      const metadata = localStorage.getItem('mesh:peers:metadata');
      const schemaVersion = localStorage.getItem('mesh:schema:version');

      if (!index || !metadata || !schemaVersion) {
        return false;
      }

      let parsedIndex;
      let parsedMetadata;

      try {
        parsedIndex = JSON.parse(index);
        parsedMetadata = JSON.parse(metadata);
      } catch (e) {
        return false;
      }

      if (!Array.isArray(parsedIndex)) {
        return false;
      }

      if (parsedIndex.length === 0) {
        return false;
      }

      for (const peerId of parsedIndex) {
        const peerKey = `mesh:peer:${peerId}`;
        const peerData = localStorage.getItem(peerKey);

        if (!peerData) {
          return false;
        }

        try {
          const peer = JSON.parse(peerData);

          if (!peer.peerId ||
              !peer.userId ||
              typeof peer.lastSeen !== 'number' ||
              typeof peer.lastConnected !== 'number' ||
              !peer.connectionQuality) {
            return false;
          }
        } catch (e) {
          return false;
        }
      }

      return true;
    },
    { timeout }
  );

  const elapsed = Date.now() - startTime;
  console.log(`[StorageHelpers] Persistence verified in ${elapsed}ms`);
}

/**
 * Validate storage integrity and schema correctness
 * @param {Page} page - Playwright page instance
 * @returns {Promise<Object>} Validation result with detailed status
 */
export async function validateStorageIntegrity(page) {
  return await page.evaluate(() => {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      stats: {
        peerCount: 0,
        corruptedPeers: 0,
        missingFields: 0,
        invalidTimestamps: 0
      }
    };

    try {
      const schemaVersion = localStorage.getItem('mesh:schema:version');
      if (!schemaVersion) {
        result.errors.push('Missing schema version');
        result.valid = false;
      } else if (schemaVersion !== '1.0.0') {
        result.warnings.push(`Unexpected schema version: ${schemaVersion}`);
      }

      const indexData = localStorage.getItem('mesh:peers:index');
      if (!indexData) {
        result.errors.push('Missing peers index');
        result.valid = false;
        return result;
      }

      let index;
      try {
        index = JSON.parse(indexData);
      } catch (e) {
        result.errors.push(`Corrupted peers index: ${e.message}`);
        result.valid = false;
        return result;
      }

      if (!Array.isArray(index)) {
        result.errors.push('Peers index is not an array');
        result.valid = false;
        return result;
      }

      const metadataData = localStorage.getItem('mesh:peers:metadata');
      if (!metadataData) {
        result.errors.push('Missing metadata');
        result.valid = false;
      } else {
        try {
          const metadata = JSON.parse(metadataData);
          if (typeof metadata.lastCleanup !== 'number' ||
              typeof metadata.totalPeers !== 'number' ||
              typeof metadata.estimatedSize !== 'number') {
            result.errors.push('Invalid metadata structure');
            result.valid = false;
          }
        } catch (e) {
          result.errors.push(`Corrupted metadata: ${e.message}`);
          result.valid = false;
        }
      }

      result.stats.peerCount = index.length;

      const now = Date.now();
      const requiredFields = [
        'peerId', 'userId', 'displayName', 'firstSeen', 'lastSeen',
        'lastConnected', 'connectionQuality', 'reconnectionAttempts',
        'dataVersion'
      ];

      const connectionQualityFields = [
        'latency', 'successRate', 'connectionType', 'lastMeasured',
        'totalConnections', 'successfulConnections', 'avgUptime'
      ];

      for (const peerId of index) {
        const peerKey = `mesh:peer:${peerId}`;
        const peerData = localStorage.getItem(peerKey);

        if (!peerData) {
          result.errors.push(`Missing data for peer: ${peerId}`);
          result.stats.corruptedPeers++;
          result.valid = false;
          continue;
        }

        let peer;
        try {
          peer = JSON.parse(peerData);
        } catch (e) {
          result.errors.push(`Corrupted data for peer ${peerId}: ${e.message}`);
          result.stats.corruptedPeers++;
          result.valid = false;
          continue;
        }

        for (const field of requiredFields) {
          if (!(field in peer)) {
            result.errors.push(`Peer ${peerId} missing required field: ${field}`);
            result.stats.missingFields++;
            result.valid = false;
          }
        }

        if (peer.connectionQuality) {
          for (const field of connectionQualityFields) {
            if (!(field in peer.connectionQuality)) {
              result.errors.push(`Peer ${peerId} missing connectionQuality field: ${field}`);
              result.stats.missingFields++;
              result.valid = false;
            }
          }
        } else {
          result.errors.push(`Peer ${peerId} missing connectionQuality object`);
          result.valid = false;
        }

        if (typeof peer.lastSeen !== 'number' || peer.lastSeen > now || peer.lastSeen < 0) {
          result.errors.push(`Peer ${peerId} has invalid lastSeen timestamp: ${peer.lastSeen}`);
          result.stats.invalidTimestamps++;
          result.valid = false;
        }

        if (typeof peer.lastConnected !== 'number' || peer.lastConnected > now || peer.lastConnected < 0) {
          result.errors.push(`Peer ${peerId} has invalid lastConnected timestamp: ${peer.lastConnected}`);
          result.stats.invalidTimestamps++;
          result.valid = false;
        }

        if (typeof peer.firstSeen !== 'number' || peer.firstSeen > now || peer.firstSeen < 0) {
          result.errors.push(`Peer ${peerId} has invalid firstSeen timestamp: ${peer.firstSeen}`);
          result.stats.invalidTimestamps++;
          result.valid = false;
        }

        if (peer.connectionQuality && typeof peer.connectionQuality.lastMeasured !== 'number') {
          result.errors.push(`Peer ${peerId} has invalid connectionQuality.lastMeasured`);
          result.stats.invalidTimestamps++;
          result.valid = false;
        }

        if (peer.connectionQuality) {
          if (typeof peer.connectionQuality.successRate !== 'number' ||
              peer.connectionQuality.successRate < 0 ||
              peer.connectionQuality.successRate > 1) {
            result.errors.push(`Peer ${peerId} has invalid successRate: ${peer.connectionQuality.successRate}`);
            result.valid = false;
          }

          if (peer.connectionQuality.connectionType !== null &&
              !['host', 'srflx', 'relay'].includes(peer.connectionQuality.connectionType)) {
            result.errors.push(`Peer ${peerId} has invalid connectionType: ${peer.connectionQuality.connectionType}`);
            result.valid = false;
          }
        }

        if (peer.dataVersion !== '1.0.0') {
          result.warnings.push(`Peer ${peerId} has unexpected dataVersion: ${peer.dataVersion}`);
        }
      }

      const encryptionKey = localStorage.getItem('mesh:encryption:key');
      if (encryptionKey) {
        try {
          JSON.parse(encryptionKey);
        } catch (e) {
          result.errors.push(`Corrupted encryption key: ${e.message}`);
          result.valid = false;
        }
      }

    } catch (e) {
      result.errors.push(`Unexpected validation error: ${e.message}`);
      result.valid = false;
    }

    return result;
  });
}

/**
 * Verify that localStorage data was successfully loaded into application state
 * @param {Page} page - Playwright page instance
 * @returns {Promise<Object>} Load verification result
 */
export async function verifyLocalStorageWasLoaded(page) {
  return await page.evaluate(() => {
    const result = {
      loaded: false,
      peersLoadedCount: 0,
      indexMatchesLoaded: false,
      details: {
        hasIndex: false,
        indexCount: 0,
        errors: []
      }
    };

    try {
      const indexData = localStorage.getItem('mesh:peers:index');
      if (!indexData) {
        result.details.errors.push('No peers index in localStorage');
        return result;
      }

      let index;
      try {
        index = JSON.parse(indexData);
      } catch (e) {
        result.details.errors.push(`Failed to parse index: ${e.message}`);
        return result;
      }

      result.details.hasIndex = true;
      result.details.indexCount = index.length;

      if (index.length === 0) {
        result.loaded = true;
        result.indexMatchesLoaded = true;
        return result;
      }

      let loadedCount = 0;
      for (const peerId of index) {
        const peerKey = `mesh:peer:${peerId}`;
        const peerData = localStorage.getItem(peerKey);

        if (peerData) {
          try {
            const peer = JSON.parse(peerData);
            if (peer.peerId && peer.lastConnected && peer.connectionQuality) {
              loadedCount++;
            }
          } catch (e) {
            result.details.errors.push(`Failed to parse peer ${peerId}: ${e.message}`);
          }
        }
      }

      result.peersLoadedCount = loadedCount;
      result.loaded = loadedCount > 0;
      result.indexMatchesLoaded = loadedCount === index.length;

    } catch (e) {
      result.details.errors.push(`Unexpected error: ${e.message}`);
    }

    return result;
  });
}

/**
 * Verify that a specific peer was loaded from storage with historical data
 * @param {Page} page - Playwright page instance
 * @param {string} peerId - Peer ID to verify
 * @returns {Promise<Object>} Verification result with peer details
 */
export async function wasPeerLoadedFromStorage(page, peerId) {
  return await page.evaluate((targetPeerId) => {
    const result = {
      found: false,
      valid: false,
      hasHistoricalData: false,
      peer: null,
      errors: [],
      historicalFields: {
        hasLastConnected: false,
        hasConnectionQuality: false,
        hasFirstSeen: false,
        hasLastSeen: false,
        hasReconnectionAttempts: false
      }
    };

    try {
      const peerKey = `mesh:peer:${targetPeerId}`;
      const peerData = localStorage.getItem(peerKey);

      if (!peerData) {
        result.errors.push('Peer not found in localStorage');
        return result;
      }

      result.found = true;

      let peer;
      try {
        peer = JSON.parse(peerData);
        result.peer = peer;
      } catch (e) {
        result.errors.push(`Failed to parse peer data: ${e.message}`);
        return result;
      }

      if (!peer.peerId || peer.peerId !== targetPeerId) {
        result.errors.push('Peer ID mismatch');
        return result;
      }

      const requiredFields = ['userId', 'displayName', 'firstSeen', 'lastSeen', 'lastConnected'];
      const missingFields = requiredFields.filter(field => !(field in peer));

      if (missingFields.length > 0) {
        result.errors.push(`Missing required fields: ${missingFields.join(', ')}`);
        return result;
      }

      result.valid = true;

      if (typeof peer.lastConnected === 'number' && peer.lastConnected > 0) {
        result.historicalFields.hasLastConnected = true;
      }

      if (typeof peer.firstSeen === 'number' && peer.firstSeen > 0) {
        result.historicalFields.hasFirstSeen = true;
      }

      if (typeof peer.lastSeen === 'number' && peer.lastSeen > 0) {
        result.historicalFields.hasLastSeen = true;
      }

      if (typeof peer.reconnectionAttempts === 'number') {
        result.historicalFields.hasReconnectionAttempts = true;
      }

      if (peer.connectionQuality && typeof peer.connectionQuality === 'object') {
        result.historicalFields.hasConnectionQuality = true;

        const qualityFields = [
          'latency', 'successRate', 'connectionType', 'lastMeasured',
          'totalConnections', 'successfulConnections', 'avgUptime'
        ];

        const missingQualityFields = qualityFields.filter(
          field => !(field in peer.connectionQuality)
        );

        if (missingQualityFields.length > 0) {
          result.errors.push(`Missing connectionQuality fields: ${missingQualityFields.join(', ')}`);
          result.historicalFields.hasConnectionQuality = false;
        }

        if (peer.connectionQuality.lastMeasured &&
            peer.connectionQuality.totalConnections > 0) {
          result.hasHistoricalData = true;
        }
      } else {
        result.errors.push('Missing or invalid connectionQuality');
      }

      if (result.historicalFields.hasLastConnected &&
          result.historicalFields.hasConnectionQuality &&
          result.historicalFields.hasFirstSeen) {
        result.hasHistoricalData = true;
      }

      const now = Date.now();
      if (peer.lastConnected > now || peer.lastSeen > now || peer.firstSeen > now) {
        result.errors.push('Invalid timestamp detected (future date)');
        result.hasHistoricalData = false;
      }

    } catch (e) {
      result.errors.push(`Unexpected error: ${e.message}`);
    }

    return result;
  }, peerId);
}
