import { test, expect } from '@playwright/test';
import { chromium } from '@playwright/test';
import path from 'path';
import { PeerContext } from './utils/peer-context.js';
import {
  manualPeerConnection,
  waitForPeerCount,
  getConnectedPeerCount,
  getPeerUUID
} from './utils/connection-helpers.js';
import { waitForPeerInList, sendMessage, waitForMessage } from './utils/ui-helpers.js';
import {
  getLocalStorageKey,
  getPeerPersistenceData
} from './utils/storage-helpers.js';

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

    await peer1Context.page.waitForFunction(
      () => window.mesh && window.mesh.peers && window.mesh.peers.size > 0,
      { timeout: 10000 }
    );

    const peer2UUID = await getPeerUUID(peer2Context.page);

    const beforeStorage = await getPeerPersistenceData(peer1Context.page);
    expect(beforeStorage.identity).toBeTruthy();
    expect(beforeStorage.reconnectionIdentity).toBeTruthy();

    const identityData = JSON.parse(beforeStorage.identity);
    expect(identityData).toHaveProperty('uuid');
    expect(identityData).toHaveProperty('displayName');

    const reconnectionIdentityData = JSON.parse(beforeStorage.reconnectionIdentity);
    expect(reconnectionIdentityData).toHaveProperty('iv');
    expect(reconnectionIdentityData).toHaveProperty('data');
    expect(Array.isArray(reconnectionIdentityData.iv)).toBe(true);
    expect(Array.isArray(reconnectionIdentityData.data)).toBe(true);

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

    const afterStorage = await getPeerPersistenceData(peer1Context.page);

    expect(afterStorage.identity).toBe(beforeStorage.identity);
    expect(afterStorage.reconnectionIdentity).toBe(beforeStorage.reconnectionIdentity);

    const peerTrustData = afterStorage.peerTrust ? JSON.parse(afterStorage.peerTrust) : null;
    if (peerTrustData) {
      expect(peerTrustData).toHaveProperty('iv');
      expect(peerTrustData).toHaveProperty('data');
    }

    const schemaVersion = await getLocalStorageKey(peer1Context.page, 'mesh:schema:version');
    expect(schemaVersion).toBe('1.0.0');

    const encryptionKey = await getLocalStorageKey(peer1Context.page, 'mesh:encryption:key');
    expect(encryptionKey).toBeTruthy();
    const encryptionKeyData = JSON.parse(encryptionKey);
    expect(encryptionKeyData).toHaveProperty('kty');
    expect(encryptionKeyData).toHaveProperty('k');

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

    await peer1Context.page.waitForFunction(
      () => window.mesh && window.mesh.peers && window.mesh.peers.size > 0,
      { timeout: 10000 }
    );
    await peer2Context.page.waitForFunction(
      () => window.mesh && window.mesh.peers && window.mesh.peers.size > 0,
      { timeout: 10000 }
    );

    const peer1UUID = await getPeerUUID(peer1Context.page);
    const peer2UUID = await getPeerUUID(peer2Context.page);

    const peer1StorageBefore = await getPeerPersistenceData(peer1Context.page);
    const peer2StorageBefore = await getPeerPersistenceData(peer2Context.page);

    expect(peer1StorageBefore.index).toContain(peer2UUID);
    expect(peer2StorageBefore.index).toContain(peer1UUID);

    expect(peer1StorageBefore.peers[peer2UUID]).toBeDefined();
    expect(peer2StorageBefore.peers[peer1UUID]).toBeDefined();

    const peer1EncryptionKeyBefore = await getLocalStorageKey(peer1Context.page, 'mesh:encryption:key');
    const peer2EncryptionKeyBefore = await getLocalStorageKey(peer2Context.page, 'mesh:encryption:key');

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

    await peer2Context.page.waitForFunction(
      () => window.mesh && typeof window.mesh.createOffer === 'function',
      { timeout: 10000 }
    );

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer1Context.page.waitForSelector('#messageInput');

    await waitForPeerCount(peer1Context.page, 1, 45000);
    await waitForPeerCount(peer2Context.page, 1, 45000);

    const peer1StorageAfter = await getPeerPersistenceData(peer1Context.page);
    const peer2StorageAfter = await getPeerPersistenceData(peer2Context.page);

    expect(peer1StorageAfter.identity).toBe(peer1StorageBefore.identity);
    expect(peer2StorageAfter.identity).toBe(peer2StorageBefore.identity);

    const peer1EncryptionKeyAfter = await getLocalStorageKey(peer1Context.page, 'mesh:encryption:key');
    const peer2EncryptionKeyAfter = await getLocalStorageKey(peer2Context.page, 'mesh:encryption:key');
    expect(peer1EncryptionKeyAfter).toBe(peer1EncryptionKeyBefore);
    expect(peer2EncryptionKeyAfter).toBe(peer2EncryptionKeyBefore);

    expect(peer1StorageAfter.peers[peer2UUID]).toBeDefined();
    expect(peer2StorageAfter.peers[peer1UUID]).toBeDefined();

    const peer2DataInPeer1 = peer1StorageAfter.peers[peer2UUID];
    expect(peer2DataInPeer1).toHaveProperty('peerId', peer2UUID);
    expect(peer2DataInPeer1).toHaveProperty('displayName');
    expect(peer2DataInPeer1).toHaveProperty('firstSeen');
    expect(peer2DataInPeer1).toHaveProperty('lastSeen');
    expect(peer2DataInPeer1).toHaveProperty('lastConnected');
    expect(peer2DataInPeer1).toHaveProperty('publicKey');
    expect(peer2DataInPeer1).toHaveProperty('encryptedSecret');
    expect(peer2DataInPeer1).toHaveProperty('connectionQuality');
    expect(peer2DataInPeer1).toHaveProperty('dataVersion', '1.0.0');

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

    await peer1Context.page.waitForFunction(
      (name) => document.querySelector('#displayName')?.textContent === name,
      customName,
      { timeout: 5000 }
    );

    const beforeClose = await peer1Context.page.textContent('#displayName');
    expect(beforeClose).toBe(customName);

    const beforeStorage = await getPeerPersistenceData(peer1Context.page);
    const beforeIdentity = JSON.parse(beforeStorage.identity);
    expect(beforeIdentity.displayName).toBe(customName);

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

    const afterStorage = await getPeerPersistenceData(peer1Context.page);
    const afterIdentity = JSON.parse(afterStorage.identity);
    expect(afterIdentity.displayName).toBe(customName);
    expect(afterIdentity.uuid).toBe(beforeIdentity.uuid);
  });

  test('should verify storage schema correctness', async () => {
    browser1 = await chromium.launch();
    browser2 = await chromium.launch();

    peer1Context = new PeerContext(browser1, 'schema-verify-peer1');
    peer2Context = new PeerContext(browser2, 'schema-verify-peer2');

    await peer1Context.initialize();
    await peer2Context.initialize();

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2Context.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1Context.page.waitForSelector('#messageInput');
    await peer2Context.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1Context.page, peer2Context.page);

    await waitForPeerCount(peer1Context.page, 1);
    await waitForPeerCount(peer2Context.page, 1);

    await peer1Context.page.waitForFunction(
      () => window.mesh && window.mesh.peers && window.mesh.peers.size > 0,
      { timeout: 10000 }
    );

    const schemaVersion = await getLocalStorageKey(peer1Context.page, 'mesh:schema:version');
    expect(schemaVersion).toBe('1.0.0');

    const peersIndex = await getLocalStorageKey(peer1Context.page, 'mesh:peers:index');
    expect(peersIndex).toBeTruthy();
    const indexArray = JSON.parse(peersIndex);
    expect(Array.isArray(indexArray)).toBe(true);
    expect(indexArray.length).toBeGreaterThan(0);

    const metadata = await getLocalStorageKey(peer1Context.page, 'mesh:peers:metadata');
    expect(metadata).toBeTruthy();
    const metadataObj = JSON.parse(metadata);
    expect(metadataObj).toHaveProperty('lastCleanup');
    expect(metadataObj).toHaveProperty('totalPeers');
    expect(metadataObj).toHaveProperty('estimatedSize');
    expect(metadataObj).toHaveProperty('statistics');
    expect(typeof metadataObj.lastCleanup).toBe('number');

    const encryptionKey = await getLocalStorageKey(peer1Context.page, 'mesh:encryption:key');
    expect(encryptionKey).toBeTruthy();
    const keyData = JSON.parse(encryptionKey);
    expect(keyData).toHaveProperty('kty');
    expect(keyData).toHaveProperty('k');
    expect(keyData).toHaveProperty('alg');
    expect(keyData.kty).toBe('oct');

    const peer2UUID = await getPeerUUID(peer2Context.page);
    const peerKey = `mesh:peer:${peer2UUID}`;
    const peerData = await getLocalStorageKey(peer1Context.page, peerKey);
    expect(peerData).toBeTruthy();
    const peerObj = JSON.parse(peerData);
    expect(peerObj).toHaveProperty('peerId', peer2UUID);
    expect(peerObj).toHaveProperty('displayName');
    expect(peerObj).toHaveProperty('firstSeen');
    expect(peerObj).toHaveProperty('lastSeen');
    expect(peerObj).toHaveProperty('lastConnected');
    expect(peerObj).toHaveProperty('publicKey');
    expect(peerObj).toHaveProperty('encryptedSecret');
    expect(peerObj).toHaveProperty('connectionQuality');
    expect(peerObj).toHaveProperty('reconnectionAttempts');
    expect(peerObj).toHaveProperty('blacklistUntil');
    expect(peerObj).toHaveProperty('metadata');
    expect(peerObj).toHaveProperty('dataVersion', '1.0.0');

    expect(typeof peerObj.firstSeen).toBe('number');
    expect(typeof peerObj.lastSeen).toBe('number');
    expect(typeof peerObj.lastConnected).toBe('number');
    expect(typeof peerObj.reconnectionAttempts).toBe('number');
    expect(peerObj.connectionQuality).toHaveProperty('latency');
    expect(peerObj.connectionQuality).toHaveProperty('successRate');
    expect(peerObj.connectionQuality).toHaveProperty('connectionType');
    expect(peerObj.connectionQuality).toHaveProperty('lastMeasured');
    expect(peerObj.connectionQuality).toHaveProperty('totalConnections');
    expect(peerObj.connectionQuality).toHaveProperty('successfulConnections');
    expect(peerObj.connectionQuality).toHaveProperty('avgUptime');
  });

  test('should verify encryption key persistence', async () => {
    browser1 = await chromium.launch();

    peer1Context = new PeerContext(browser1, 'encryption-key-persist');
    await peer1Context.initialize();

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer1Context.page.waitForSelector('#messageInput');

    await peer1Context.page.waitForFunction(
      () => window.mesh && typeof window.mesh.createOffer === 'function',
      { timeout: 10000 }
    );

    const encryptionKeyBefore = await getLocalStorageKey(peer1Context.page, 'mesh:encryption:key');
    expect(encryptionKeyBefore).toBeTruthy();

    const storagePath = path.join(process.cwd(), '.temp', 'encryption-key-storage.json');
    await peer1Context.saveStorageState(storagePath);

    await peer1Context.close();
    await browser1.close();

    browser1 = await chromium.launch();
    peer1Context = new PeerContext(browser1, 'encryption-key-persist-restored');
    await peer1Context.initialize({ storageState: storagePath });

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer1Context.page.waitForSelector('#messageInput');

    const encryptionKeyAfter = await getLocalStorageKey(peer1Context.page, 'mesh:encryption:key');
    expect(encryptionKeyAfter).toBe(encryptionKeyBefore);

    const keyData = JSON.parse(encryptionKeyAfter);
    expect(keyData.kty).toBe('oct');
    expect(keyData.alg).toBe('A256GCM');
    expect(keyData.k).toBeTruthy();
    expect(keyData.ext).toBe(true);
    expect(keyData.key_ops).toContain('encrypt');
    expect(keyData.key_ops).toContain('decrypt');
  });

  test('should verify peer data completeness after reconnection', async () => {
    browser1 = await chromium.launch();
    browser2 = await chromium.launch();

    peer1Context = new PeerContext(browser1, 'data-completeness-peer1');
    peer2Context = new PeerContext(browser2, 'data-completeness-peer2');

    await peer1Context.initialize();
    await peer2Context.initialize();

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2Context.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1Context.page.waitForSelector('#messageInput');
    await peer2Context.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1Context.page, peer2Context.page);

    await waitForPeerCount(peer1Context.page, 1);
    await waitForPeerCount(peer2Context.page, 1);

    await peer1Context.page.waitForFunction(
      () => window.mesh && window.mesh.peers && window.mesh.peers.size > 0,
      { timeout: 10000 }
    );

    const peer2UUID = await getPeerUUID(peer2Context.page);

    const testMessage = 'Test message before restart';
    await sendMessage(peer1Context.page, testMessage);
    await waitForMessage(peer2Context.page, testMessage, 10000);

    const storagePath = path.join(process.cwd(), '.temp', 'data-completeness-storage.json');
    await peer1Context.saveStorageState(storagePath);

    const beforeStorage = await getPeerPersistenceData(peer1Context.page);
    const beforePeerData = beforeStorage.peers[peer2UUID];
    expect(beforePeerData).toBeDefined();

    await peer1Context.close();
    await browser1.close();

    browser1 = await chromium.launch();
    peer1Context = new PeerContext(browser1, 'data-completeness-peer1-restored');
    await peer1Context.initialize({ storageState: storagePath });

    await peer1Context.goto('/', { waitUntil: 'domcontentloaded' });
    await peer1Context.page.waitForSelector('#messageInput');

    await waitForPeerCount(peer1Context.page, 1, 45000);

    const afterStorage = await getPeerPersistenceData(peer1Context.page);
    const afterPeerData = afterStorage.peers[peer2UUID];
    expect(afterPeerData).toBeDefined();

    expect(afterPeerData.peerId).toBe(beforePeerData.peerId);
    expect(afterPeerData.displayName).toBe(beforePeerData.displayName);
    expect(afterPeerData.firstSeen).toBe(beforePeerData.firstSeen);
    expect(afterPeerData.publicKey).toBe(beforePeerData.publicKey);
    expect(afterPeerData.encryptedSecret).toBe(beforePeerData.encryptedSecret);
    expect(afterPeerData.dataVersion).toBe(beforePeerData.dataVersion);

    expect(afterPeerData.lastSeen).toBeGreaterThanOrEqual(beforePeerData.lastSeen);
    expect(afterPeerData.lastConnected).toBeGreaterThanOrEqual(beforePeerData.lastConnected);

    expect(afterPeerData.connectionQuality).toBeDefined();
    expect(afterPeerData.connectionQuality.successRate).toBeGreaterThan(0);
    expect(afterPeerData.connectionQuality.totalConnections).toBeGreaterThanOrEqual(beforePeerData.connectionQuality.totalConnections);

    const testMessage2 = 'Message after reconnection';
    await sendMessage(peer1Context.page, testMessage2);
    await waitForMessage(peer2Context.page, testMessage2, 15000);
  });
});
