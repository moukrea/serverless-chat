import { test, expect } from '@playwright/test';
import { createPeerContexts, cleanupPeerContexts } from './utils/peer-context.js';
import { manualPeerConnection, getDisplayName } from './utils/connection-helpers.js';
import {
  setDisplayNameViaPrompt,
  getDisplayedUserName,
  getPeersList,
  waitForPeerInList
} from './utils/ui-helpers.js';

test.describe('Display Name Tests', () => {
  let peerContexts = [];

  test.afterEach(async () => {
    await cleanupPeerContexts(peerContexts);
    peerContexts = [];
  });

  test('should display auto-generated display name on load', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 1);
    const [peer1] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer1.page.waitForSelector('#messageInput');

    const displayName = await getDisplayName(peer1.page);
    expect(displayName).toBeTruthy();
    expect(displayName).not.toBe('Loading...');
  });

  test('should change display name and persist in UI', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 1);
    const [peer1] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer1.page.waitForSelector('#messageInput');

    const newName = 'Test User Alpha';
    await setDisplayNameViaPrompt(peer1.page, newName);

    const displayedName = await getDisplayedUserName(peer1.page);
    expect(displayedName).toBe(newName);

    const identityName = await getDisplayName(peer1.page);
    expect(identityName).toBe(newName);
  });

  test('should propagate display name change to connected peer', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    await waitForPeerInList(peer1.page, 1);
    await waitForPeerInList(peer2.page, 1);

    const newName = 'Updated Name';
    await setDisplayNameViaPrompt(peer1.page, newName);

    await peer2.page.waitForTimeout(2000);

    const peer2List = await getPeersList(peer2.page);
    expect(peer2List.length).toBe(1);
    expect(peer2List[0].name).toContain(newName);
  });

  test('should show updated display name in peer list for all peers in mesh', async ({ browser }) => {
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

    await waitForPeerInList(peer1.page, 2);
    await peer2.page.waitForTimeout(35000);
    await peer3.page.waitForTimeout(1000);

    const newName = 'Mesh Leader';
    await setDisplayNameViaPrompt(peer1.page, newName);

    await peer2.page.waitForTimeout(2000);
    await peer3.page.waitForTimeout(2000);

    const peer2List = await getPeersList(peer2.page);
    const peer3List = await getPeersList(peer3.page);

    const peer1InPeer2List = peer2List.find(p => p.name.includes(newName));
    const peer1InPeer3List = peer3List.find(p => p.name.includes(newName));

    expect(peer1InPeer2List).toBeTruthy();
    expect(peer1InPeer3List).toBeTruthy();
  });

  test('should persist display name across page reload', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 1);
    const [peer1] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer1.page.waitForSelector('#messageInput');

    const newName = 'Persistent User';
    await setDisplayNameViaPrompt(peer1.page, newName);

    const beforeReload = await getDisplayedUserName(peer1.page);
    expect(beforeReload).toBe(newName);

    await peer1.page.reload({ waitUntil: 'domcontentloaded' });
    await peer1.page.waitForSelector('#messageInput');

    const afterReload = await getDisplayedUserName(peer1.page);
    expect(afterReload).toBe(newName);
  });
});
