import { test, expect } from '@playwright/test';
import { createPeerContexts, cleanupPeerContexts } from './utils/peer-context.js';
import {
  manualPeerConnection,
  waitForPeerCount,
  getConnectedPeerCount,
  waitForReconnection
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

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerInList(peer1.page, 1);

    await peer1.page.waitForTimeout(2000);

    const persistenceData = await getPeerPersistenceData(peer1.page);

    expect(persistenceData.index).toBeTruthy();
    expect(persistenceData.index.length).toBeGreaterThan(0);
    expect(Object.keys(persistenceData.peers).length).toBeGreaterThan(0);
  });

  test('should automatically reconnect after page refresh', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerCount(peer1.page, 1);
    await waitForPeerCount(peer2.page, 1);

    await peer1.page.waitForTimeout(3000);

    await peer1.page.reload();
    await peer1.page.waitForSelector('#messageInput');

    await waitForReconnection(peer1.page, 45000);

    const reconnectedCount = await getConnectedPeerCount(peer1.page);
    expect(reconnectedCount).toBeGreaterThan(0);

    await waitForPeerInList(peer1.page, 1, 15000);
  });

  test('should reconnect and exchange messages after refresh', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerCount(peer1.page, 1);
    await waitForPeerCount(peer2.page, 1);

    await peer1.page.waitForTimeout(3000);

    await peer1.page.reload();
    await peer1.page.waitForSelector('#messageInput');

    await waitForReconnection(peer1.page, 45000);
    await waitForPeerInList(peer1.page, 1, 15000);

    const testMessage = 'Message after reconnection';
    await sendMessage(peer1.page, testMessage);

    await waitForMessage(peer2.page, testMessage, 15000);

    const response = 'Response to reconnected peer';
    await sendMessage(peer2.page, response);

    await waitForMessage(peer1.page, response, 15000);
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

    await manualPeerConnection(peer1.page, peer2.page);
    await manualPeerConnection(peer1.page, peer3.page);

    await waitForPeerCount(peer1.page, 2);
    await waitForPeerCount(peer2.page, 2, 35000);
    await waitForPeerCount(peer3.page, 2, 35000);

    await peer1.page.waitForTimeout(3000);

    await peer1.page.reload();
    await peer1.page.waitForSelector('#messageInput');

    await waitForReconnection(peer1.page, 45000);

    const reconnectedCount = await getConnectedPeerCount(peer1.page);
    expect(reconnectedCount).toBeGreaterThanOrEqual(1);
  });

  test('should handle multiple sequential refreshes', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerCount(peer1.page, 1);
    await waitForPeerCount(peer2.page, 1);

    for (let i = 0; i < 2; i++) {
      await peer1.page.waitForTimeout(3000);

      await peer1.page.reload();
      await peer1.page.waitForSelector('#messageInput');

      await waitForReconnection(peer1.page, 45000);

      const count = await getConnectedPeerCount(peer1.page);
      expect(count).toBeGreaterThan(0);
    }
  });
});
