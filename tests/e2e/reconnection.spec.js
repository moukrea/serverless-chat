import { test, expect } from '@playwright/test';
import { createPeerContexts, cleanupPeerContexts } from './utils/peer-context.js';
import {
  manualPeerConnection,
  waitForPeerCount,
  getConnectedPeerCount,
  getPeerUUID
} from './utils/connection-helpers.js';
import { waitForPeerInList, sendMessage, waitForMessage } from './utils/ui-helpers.js';
import { getPeerPersistenceData } from './utils/storage-helpers.js';

test.describe('Automatic Reconnection Tests', () => {
  let peerContexts = [];

  test.afterEach(async () => {
    await cleanupPeerContexts(peerContexts);
    peerContexts = [];
  });

  test('should persist peer data to localStorage after connection', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await peer1.page.waitForFunction(
      () => window.mesh && typeof window.mesh.createOffer === 'function',
      { timeout: 10000 }
    );
    await peer2.page.waitForFunction(
      () => window.mesh && typeof window.mesh.createOffer === 'function',
      { timeout: 10000 }
    );

    const peer1UUID = await getPeerUUID(peer1.page);
    const peer2UUID = await getPeerUUID(peer2.page);

    expect(peer1UUID).toBeTruthy();
    expect(peer2UUID).toBeTruthy();
    expect(peer1UUID).not.toBe(peer2UUID);

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerInList(peer1.page, 1);

    await peer1.page.waitForFunction(
      (expectedPeerUUID) => {
        const indexData = localStorage.getItem('mesh:peers:index');
        if (!indexData) return false;
        const index = JSON.parse(indexData);
        return index.includes(expectedPeerUUID);
      },
      peer2UUID,
      { timeout: 10000 }
    );

    const persistenceData = await getPeerPersistenceData(peer1.page);

    expect(persistenceData.index).toBeTruthy();
    expect(persistenceData.index.length).toBeGreaterThan(0);
    expect(persistenceData.index).toContain(peer2UUID);
    expect(Object.keys(persistenceData.peers).length).toBeGreaterThan(0);
    expect(persistenceData.peers[peer2UUID]).toBeTruthy();
    expect(persistenceData.peers[peer2UUID].peerId).toBe(peer2UUID);
    expect(persistenceData.peers[peer2UUID].displayName).toBeTruthy();
  });

  test('should automatically reconnect after page refresh', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await peer1.page.waitForFunction(
      () => window.mesh && typeof window.mesh.createOffer === 'function',
      { timeout: 10000 }
    );
    await peer2.page.waitForFunction(
      () => window.mesh && typeof window.mesh.createOffer === 'function',
      { timeout: 10000 }
    );

    const peer1UUIDBeforeReload = await getPeerUUID(peer1.page);
    const peer2UUID = await getPeerUUID(peer2.page);

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerCount(peer1.page, 1);
    await waitForPeerCount(peer2.page, 1);

    await peer1.page.waitForFunction(
      (expectedPeerUUID) => {
        const indexData = localStorage.getItem('mesh:peers:index');
        if (!indexData) return false;
        const index = JSON.parse(indexData);
        return index.includes(expectedPeerUUID);
      },
      peer2UUID,
      { timeout: 10000 }
    );

    const persistenceBeforeReload = await getPeerPersistenceData(peer1.page);
    expect(persistenceBeforeReload.peers[peer2UUID]).toBeTruthy();

    await peer1.page.reload({ waitUntil: 'domcontentloaded' });
    await peer1.page.waitForSelector('#messageInput');

    const peer1UUIDAfterReload = await getPeerUUID(peer1.page);
    expect(peer1UUIDAfterReload).toBe(peer1UUIDBeforeReload);

    const persistenceAfterReload = await getPeerPersistenceData(peer1.page);
    expect(persistenceAfterReload.peers[peer2UUID]).toBeTruthy();
    expect(persistenceAfterReload.peers[peer2UUID].peerId).toBe(peer2UUID);

    let reconnectionExecuted = false;
    await peer1.page.waitForFunction(
      () => {
        const mesh = window.mesh;
        if (!mesh || !mesh.masterReconnect) return false;
        const stats = mesh.masterReconnect.getStats();
        return stats && stats.totalAttempts > 0;
      },
      { timeout: 45000 }
    ).then(() => { reconnectionExecuted = true; }).catch(() => {});

    expect(reconnectionExecuted).toBe(true);

    await waitForPeerCount(peer1.page, 1, 45000);

    const reconnectedCount = await getConnectedPeerCount(peer1.page);
    expect(reconnectedCount).toBeGreaterThan(0);

    const connectedPeers = await peer1.page.evaluate(() => {
      const mesh = window.mesh;
      if (!mesh || !mesh.peers) return [];
      return Array.from(mesh.peers.entries())
        .filter(([uuid, data]) => data.status === 'connected')
        .map(([uuid]) => uuid);
    });

    expect(connectedPeers).toContain(peer2UUID);

    await waitForPeerInList(peer1.page, 1, 15000);

    const reconnectionStats = await peer1.page.evaluate(() => {
      const mesh = window.mesh;
      if (!mesh || !mesh.masterReconnect) return null;
      return mesh.masterReconnect.getStats();
    });

    expect(reconnectionStats).toBeTruthy();
    expect(reconnectionStats.totalAttempts).toBeGreaterThan(0);
    expect(reconnectionStats.successfulReconnections).toBeGreaterThan(0);
  });

  test('should reconnect and exchange messages after refresh', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await peer1.page.waitForFunction(
      () => window.mesh && typeof window.mesh.createOffer === 'function',
      { timeout: 10000 }
    );
    await peer2.page.waitForFunction(
      () => window.mesh && typeof window.mesh.createOffer === 'function',
      { timeout: 10000 }
    );

    const peer1UUIDBeforeReload = await getPeerUUID(peer1.page);
    const peer2UUID = await getPeerUUID(peer2.page);

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerCount(peer1.page, 1);
    await waitForPeerCount(peer2.page, 1);

    await peer1.page.waitForFunction(
      (expectedPeerUUID) => {
        const indexData = localStorage.getItem('mesh:peers:index');
        if (!indexData) return false;
        const index = JSON.parse(indexData);
        return index.includes(expectedPeerUUID);
      },
      peer2UUID,
      { timeout: 10000 }
    );

    await peer1.page.reload({ waitUntil: 'domcontentloaded' });
    await peer1.page.waitForSelector('#messageInput');

    const peer1UUIDAfterReload = await getPeerUUID(peer1.page);
    expect(peer1UUIDAfterReload).toBe(peer1UUIDBeforeReload);

    const persistenceAfterReload = await getPeerPersistenceData(peer1.page);
    expect(persistenceAfterReload.peers[peer2UUID]).toBeTruthy();

    await peer1.page.waitForFunction(
      () => {
        const mesh = window.mesh;
        if (!mesh || !mesh.masterReconnect) return false;
        const stats = mesh.masterReconnect.getStats();
        return stats && stats.totalAttempts > 0;
      },
      { timeout: 45000 }
    );

    await waitForPeerCount(peer1.page, 1, 45000);
    await waitForPeerInList(peer1.page, 1, 15000);

    const connectedPeersAfterReconnect = await peer1.page.evaluate(() => {
      const mesh = window.mesh;
      if (!mesh || !mesh.peers) return [];
      return Array.from(mesh.peers.entries())
        .filter(([uuid, data]) => data.status === 'connected')
        .map(([uuid]) => uuid);
    });

    expect(connectedPeersAfterReconnect).toContain(peer2UUID);

    const testMessage = 'Message after reconnection';
    await sendMessage(peer1.page, testMessage);

    await waitForMessage(peer2.page, testMessage, 15000);

    const response = 'Response to reconnected peer';
    await sendMessage(peer2.page, response);

    await waitForMessage(peer1.page, response, 15000);

    const reconnectionStats = await peer1.page.evaluate(() => {
      const mesh = window.mesh;
      if (!mesh || !mesh.masterReconnect) return null;
      return mesh.masterReconnect.getStats();
    });

    expect(reconnectionStats.successfulReconnections).toBeGreaterThan(0);
    expect(reconnectionStats.lastResult).toBeTruthy();
    expect(reconnectionStats.lastResult.success).toBe(true);
  });

  test('should reconnect to mesh after refresh when other peers stay connected', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 3);
    const [peer1, peer2, peer3] = peerContexts;

    await Promise.all([
      peer1.goto('/', { waitUntil: 'domcontentloaded' }),
      peer2.goto('/', { waitUntil: 'domcontentloaded' }),
      peer3.goto('/', { waitUntil: 'domcontentloaded' })
    ]);

    await Promise.all([
      peer1.page.waitForSelector('#messageInput'),
      peer2.page.waitForSelector('#messageInput'),
      peer3.page.waitForSelector('#messageInput')
    ]);

    await Promise.all([
      peer1.page.waitForFunction(
        () => window.mesh && typeof window.mesh.createOffer === 'function',
        { timeout: 10000 }
      ),
      peer2.page.waitForFunction(
        () => window.mesh && typeof window.mesh.createOffer === 'function',
        { timeout: 10000 }
      ),
      peer3.page.waitForFunction(
        () => window.mesh && typeof window.mesh.createOffer === 'function',
        { timeout: 10000 }
      )
    ]);

    const [peer1UUIDBeforeReload, peer2UUID, peer3UUID] = await Promise.all([
      getPeerUUID(peer1.page),
      getPeerUUID(peer2.page),
      getPeerUUID(peer3.page)
    ]);

    await manualPeerConnection(peer1.page, peer2.page);
    await manualPeerConnection(peer1.page, peer3.page);

    await waitForPeerCount(peer1.page, 2);
    await waitForPeerCount(peer2.page, 2, 35000);
    await waitForPeerCount(peer3.page, 2, 35000);

    await peer1.page.waitForFunction(
      (expectedPeerUUIDs) => {
        const indexData = localStorage.getItem('mesh:peers:index');
        if (!indexData) return false;
        const index = JSON.parse(indexData);
        return expectedPeerUUIDs.every(uuid => index.includes(uuid));
      },
      [peer2UUID, peer3UUID],
      { timeout: 10000 }
    );

    const persistenceBeforeReload = await getPeerPersistenceData(peer1.page);
    expect(persistenceBeforeReload.peers[peer2UUID]).toBeTruthy();
    expect(persistenceBeforeReload.peers[peer3UUID]).toBeTruthy();

    await peer1.page.reload({ waitUntil: 'domcontentloaded' });
    await peer1.page.waitForSelector('#messageInput');

    const peer1UUIDAfterReload = await getPeerUUID(peer1.page);
    expect(peer1UUIDAfterReload).toBe(peer1UUIDBeforeReload);

    const persistenceAfterReload = await getPeerPersistenceData(peer1.page);
    expect(persistenceAfterReload.peers[peer2UUID]).toBeTruthy();
    expect(persistenceAfterReload.peers[peer3UUID]).toBeTruthy();

    await peer1.page.waitForFunction(
      () => {
        const mesh = window.mesh;
        if (!mesh || !mesh.masterReconnect) return false;
        const stats = mesh.masterReconnect.getStats();
        return stats && stats.totalAttempts > 0;
      },
      { timeout: 45000 }
    );

    await waitForPeerCount(peer1.page, 1, 45000);

    const reconnectedCount = await getConnectedPeerCount(peer1.page);
    expect(reconnectedCount).toBeGreaterThanOrEqual(1);

    const connectedPeersAfterReconnect = await peer1.page.evaluate(() => {
      const mesh = window.mesh;
      if (!mesh || !mesh.peers) return [];
      return Array.from(mesh.peers.entries())
        .filter(([uuid, data]) => data.status === 'connected')
        .map(([uuid]) => uuid);
    });

    const reconnectedToExpectedPeer =
      connectedPeersAfterReconnect.includes(peer2UUID) ||
      connectedPeersAfterReconnect.includes(peer3UUID);

    expect(reconnectedToExpectedPeer).toBe(true);

    const reconnectionStats = await peer1.page.evaluate(() => {
      const mesh = window.mesh;
      if (!mesh || !mesh.masterReconnect) return null;
      return mesh.masterReconnect.getStats();
    });

    expect(reconnectionStats.totalAttempts).toBeGreaterThan(0);
    expect(reconnectionStats.successfulReconnections).toBeGreaterThan(0);
  });

  test('should handle multiple sequential refreshes', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await peer1.page.waitForFunction(
      () => window.mesh && typeof window.mesh.createOffer === 'function',
      { timeout: 10000 }
    );
    await peer2.page.waitForFunction(
      () => window.mesh && typeof window.mesh.createOffer === 'function',
      { timeout: 10000 }
    );

    const peer1UUIDOriginal = await getPeerUUID(peer1.page);
    const peer2UUID = await getPeerUUID(peer2.page);

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerCount(peer1.page, 1);
    await waitForPeerCount(peer2.page, 1);

    await peer1.page.waitForFunction(
      (expectedPeerUUID) => {
        const indexData = localStorage.getItem('mesh:peers:index');
        if (!indexData) return false;
        const index = JSON.parse(indexData);
        return index.includes(expectedPeerUUID);
      },
      peer2UUID,
      { timeout: 10000 }
    );

    for (let i = 0; i < 2; i++) {
      const attemptNumber = i + 1;

      const reconnectionStatsBeforeRefresh = await peer1.page.evaluate(() => {
        const mesh = window.mesh;
        if (!mesh || !mesh.masterReconnect) return null;
        return mesh.masterReconnect.getStats();
      });

      const previousAttempts = reconnectionStatsBeforeRefresh?.totalAttempts || 0;

      await peer1.page.reload({ waitUntil: 'domcontentloaded' });
      await peer1.page.waitForSelector('#messageInput');

      const peer1UUIDAfterReload = await getPeerUUID(peer1.page);
      expect(peer1UUIDAfterReload).toBe(peer1UUIDOriginal);

      const persistenceAfterReload = await getPeerPersistenceData(peer1.page);
      expect(persistenceAfterReload.peers[peer2UUID]).toBeTruthy();
      expect(persistenceAfterReload.peers[peer2UUID].peerId).toBe(peer2UUID);

      await peer1.page.waitForFunction(
        (previousCount) => {
          const mesh = window.mesh;
          if (!mesh || !mesh.masterReconnect) return false;
          const stats = mesh.masterReconnect.getStats();
          return stats && stats.totalAttempts > previousCount;
        },
        previousAttempts,
        { timeout: 45000 }
      );

      await waitForPeerCount(peer1.page, 1, 45000);

      const count = await getConnectedPeerCount(peer1.page);
      expect(count).toBeGreaterThan(0);

      const connectedPeers = await peer1.page.evaluate(() => {
        const mesh = window.mesh;
        if (!mesh || !mesh.peers) return [];
        return Array.from(mesh.peers.entries())
          .filter(([uuid, data]) => data.status === 'connected')
          .map(([uuid]) => uuid);
      });

      expect(connectedPeers).toContain(peer2UUID);

      const reconnectionStats = await peer1.page.evaluate(() => {
        const mesh = window.mesh;
        if (!mesh || !mesh.masterReconnect) return null;
        return mesh.masterReconnect.getStats();
      });

      expect(reconnectionStats.totalAttempts).toBe(previousAttempts + 1);
      expect(reconnectionStats.successfulReconnections).toBeGreaterThan(0);
      expect(reconnectionStats.lastResult).toBeTruthy();
      expect(reconnectionStats.lastResult.success).toBe(true);
      expect(reconnectionStats.lastResult.method).toBeTruthy();
      expect(['cold_start', 'warm_reconnection', 'direct_cached', 'mesh_relay'])
        .toContain(reconnectionStats.lastResult.method);
    }
  });
});
