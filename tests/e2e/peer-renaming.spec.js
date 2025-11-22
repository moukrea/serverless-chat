import { test, expect } from '@playwright/test';
import { createPeerContexts, cleanupPeerContexts } from './utils/peer-context.js';
import { manualPeerConnection, getPeerUUID } from './utils/connection-helpers.js';
import {
  renamePeer,
  getPeerDisplayName,
  waitForPeerInList,
  getPeersList
} from './utils/ui-helpers.js';
import { getLocalStorageKey } from './utils/storage-helpers.js';

test.describe('Peer Renaming Tests', () => {
  let peerContexts = [];

  test.afterEach(async () => {
    await cleanupPeerContexts(peerContexts);
    peerContexts = [];
  });

  test('should rename peer locally without affecting other peers', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerInList(peer1.page, 1);
    await waitForPeerInList(peer2.page, 1);

    const peer2UUID = await getPeerUUID(peer2.page);
    const peer1UUID = await getPeerUUID(peer1.page);

    const customName = 'My Custom Peer Name';
    await renamePeer(peer1.page, peer2UUID, customName);

    const displayedName = await getPeerDisplayName(peer1.page, peer2UUID);
    expect(displayedName).toContain(customName);

    const peer2DisplayName = await getPeerDisplayName(peer2.page, peer1UUID);
    expect(peer2DisplayName).not.toContain(customName);
  });

  test('should persist peer rename in localStorage', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerInList(peer1.page, 1);

    const peer2UUID = await getPeerUUID(peer2.page);
    const customName = 'Saved Custom Name';

    await renamePeer(peer1.page, peer2UUID, customName);

    const renamesData = await getLocalStorageKey(peer1.page, 'p2p_peer_renames');
    expect(renamesData).toBeTruthy();

    const renames = JSON.parse(renamesData);
    expect(renames[peer2UUID]).toBe(customName);
  });

  test('should preserve peer rename after page reload', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerInList(peer1.page, 1);

    const peer2UUID = await getPeerUUID(peer2.page);
    const customName = 'Persistent Peer Name';

    await renamePeer(peer1.page, peer2UUID, customName);

    const beforeReload = await getPeerDisplayName(peer1.page, peer2UUID);
    expect(beforeReload).toContain(customName);

    await peer1.page.reload();
    await peer1.page.waitForSelector('#messageInput');

    await waitForPeerInList(peer1.page, 1, 45000);

    const afterReload = await getPeerDisplayName(peer1.page, peer2UUID);
    expect(afterReload).toContain(customName);
  });

  test('should allow clearing custom peer name', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerInList(peer1.page, 1);

    const peer2UUID = await getPeerUUID(peer2.page);

    await renamePeer(peer1.page, peer2UUID, 'Temporary Name');

    const withCustomName = await getPeerDisplayName(peer1.page, peer2UUID);
    expect(withCustomName).toContain('Temporary Name');

    await renamePeer(peer1.page, peer2UUID, '');

    const peerList = await getPeersList(peer1.page);
    const peer = peerList.find(p => p.uuid === peer2UUID);

    expect(peer.name).not.toContain('Temporary Name');
  });
});
