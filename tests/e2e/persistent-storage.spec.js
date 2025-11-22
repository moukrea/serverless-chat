import { test, expect } from '@playwright/test';
import { chromium } from '@playwright/test';
import path from 'path';
import { PeerContext } from './utils/peer-context.js';
import {
  manualPeerConnection,
  waitForPeerCount,
  getConnectedPeerCount
} from './utils/connection-helpers.js';
import { waitForPeerInList, sendMessage, waitForMessage } from './utils/ui-helpers.js';

test.describe('Persistent Browser Storage Tests', () => {
  let browser1, browser2;
  let peer1Context, peer2Context;

  test.afterEach(async () => {
    if (peer1Context) await peer1Context.cleanup();
    if (peer2Context) await peer2Context.cleanup();
    if (browser1) await browser1.close();
    if (browser2) await browser2.close();
  });

  test('should persist data across browser close and reopen', async () => {
    browser1 = await chromium.launch();
    browser2 = await chromium.launch();

    peer1Context = new PeerContext(browser1, 'persistent-peer1');
    peer2Context = new PeerContext(browser2, 'persistent-peer2');

    await peer1Context.initialize({ usePersistentContext: false });
    await peer2Context.initialize({ usePersistentContext: false });

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2Context.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1Context.page.waitForSelector('#messageInput');
    await peer2Context.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1Context.page, peer2Context.page);

    await waitForPeerCount(peer1Context.page, 1);
    await waitForPeerCount(peer2Context.page, 1);

    await peer1Context.page.waitForTimeout(3000);

    const storageStatePath = path.join(process.cwd(), '.temp', 'peer1-storage.json');
    await peer1Context.saveStorageState(storageStatePath);

    await peer1Context.close();
    await browser1.close();

    browser1 = await chromium.launch();
    peer1Context = new PeerContext(browser1, 'persistent-peer1-restored');
    await peer1Context.initialize({ storageState: storageStatePath });

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer1Context.page.waitForSelector('#messageInput');

    await waitForPeerCount(peer1Context.page, 1, 45000);

    const reconnectedCount = await getConnectedPeerCount(peer1Context.page);
    expect(reconnectedCount).toBeGreaterThan(0);
  });

  test('should maintain connection after both peers close and reopen', async () => {
    browser1 = await chromium.launch();
    browser2 = await chromium.launch();

    peer1Context = new PeerContext(browser1, 'both-persist-peer1');
    peer2Context = new PeerContext(browser2, 'both-persist-peer2');

    await peer1Context.initialize();
    await peer2Context.initialize();

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2Context.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1Context.page.waitForSelector('#messageInput');
    await peer2Context.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1Context.page, peer2Context.page);

    await waitForPeerCount(peer1Context.page, 1);
    await waitForPeerCount(peer2Context.page, 1);

    await peer1Context.page.waitForTimeout(3000);

    const storage1Path = path.join(process.cwd(), '.temp', 'both-peer1-storage.json');
    const storage2Path = path.join(process.cwd(), '.temp', 'both-peer2-storage.json');

    await peer1Context.saveStorageState(storage1Path);
    await peer2Context.saveStorageState(storage2Path);

    await peer1Context.close();
    await peer2Context.close();
    await browser1.close();
    await browser2.close();

    browser1 = await chromium.launch();
    browser2 = await chromium.launch();

    peer1Context = new PeerContext(browser1, 'both-persist-peer1-restored');
    peer2Context = new PeerContext(browser2, 'both-persist-peer2-restored');

    await peer1Context.initialize({ storageState: storage1Path });
    await peer2Context.initialize({ storageState: storage2Path });

    await peer2Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2Context.page.waitForSelector('#messageInput');

    await peer2Context.page.waitForTimeout(3000);

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer1Context.page.waitForSelector('#messageInput');

    await waitForPeerCount(peer1Context.page, 1, 45000);
    await waitForPeerCount(peer2Context.page, 1, 45000);

    const testMessage = 'Message after both reopened';
    await sendMessage(peer1Context.page, testMessage);

    await waitForMessage(peer2Context.page, testMessage, 15000);
  });

  test('should preserve display name after browser restart', async () => {
    browser1 = await chromium.launch();

    peer1Context = new PeerContext(browser1, 'display-name-persist');
    await peer1Context.initialize();

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer1Context.page.waitForSelector('#messageInput');

    const customName = 'Persistent Display Name';

    peer1Context.page.once('dialog', async dialog => {
      await dialog.accept(customName);
    });
    await peer1Context.page.click('#btnEditName');
    await peer1Context.page.waitForTimeout(500);

    const beforeClose = await peer1Context.page.textContent('#displayName');
    expect(beforeClose).toBe(customName);

    const storagePath = path.join(process.cwd(), '.temp', 'display-name-storage.json');
    await peer1Context.saveStorageState(storagePath);

    await peer1Context.close();
    await browser1.close();

    browser1 = await chromium.launch();
    peer1Context = new PeerContext(browser1, 'display-name-persist-restored');
    await peer1Context.initialize({ storageState: storagePath });

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer1Context.page.waitForSelector('#messageInput');

    const afterReopen = await peer1Context.page.textContent('#displayName');
    expect(afterReopen).toBe(customName);
  });
});
