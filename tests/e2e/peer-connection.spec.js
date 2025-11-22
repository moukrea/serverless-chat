import { test, expect } from '@playwright/test';
import { createPeerContexts, cleanupPeerContexts } from './utils/peer-context.js';
import {
  manualPeerConnection,
  waitForPeerCount,
  getConnectedPeerCount,
  getConnectedPeers,
  getPeerUUID
} from './utils/connection-helpers.js';
import { waitForPeerInList } from './utils/ui-helpers.js';

test.describe('Peer Connection Tests', () => {
  let peerContexts = [];

  test.afterEach(async () => {
    await cleanupPeerContexts(peerContexts);
    peerContexts = [];
  });

  test('should establish connection between 2 peers', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    const peer1Count = await getConnectedPeerCount(peer1.page);
    const peer2Count = await getConnectedPeerCount(peer2.page);

    expect(peer1Count).toBe(1);
    expect(peer2Count).toBe(1);

    await waitForPeerInList(peer1.page, 1);
    await waitForPeerInList(peer2.page, 1);
  });

  test('should establish mesh connection between 3 peers', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 3);
    const [peer1, peer2, peer3] = peerContexts;

    await Promise.all([
      peer1.goto('/'),
      peer2.goto('/'),
      peer3.goto('/')
    ]);

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');
    await peer3.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerCount(peer1.page, 1);
    await waitForPeerCount(peer2.page, 1);

    await manualPeerConnection(peer1.page, peer3.page);

    await waitForPeerCount(peer1.page, 2);
    await waitForPeerCount(peer3.page, 1);

    await peer2.page.waitForTimeout(5000);
    await peer3.page.waitForTimeout(5000);

    await waitForPeerCount(peer2.page, 2, 35000);
    await waitForPeerCount(peer3.page, 2, 35000);

    const peer1Count = await getConnectedPeerCount(peer1.page);
    const peer2Count = await getConnectedPeerCount(peer2.page);
    const peer3Count = await getConnectedPeerCount(peer3.page);

    expect(peer1Count).toBe(2);
    expect(peer2Count).toBe(2);
    expect(peer3Count).toBe(2);
  });

  test('should display correct peer information in UI', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    const peer1UUID = await getPeerUUID(peer1.page);
    const peer2UUID = await getPeerUUID(peer2.page);

    expect(peer1UUID).toBeTruthy();
    expect(peer2UUID).toBeTruthy();
    expect(peer1UUID).not.toBe(peer2UUID);

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerInList(peer1.page, 1);
    await waitForPeerInList(peer2.page, 1);

    const peer1Peers = await getConnectedPeers(peer1.page);
    const peer2Peers = await getConnectedPeers(peer2.page);

    expect(peer1Peers.length).toBe(1);
    expect(peer2Peers.length).toBe(1);

    expect(peer1Peers[0].uuid).toBe(peer2UUID);
    expect(peer2Peers[0].uuid).toBe(peer1UUID);
  });
});
