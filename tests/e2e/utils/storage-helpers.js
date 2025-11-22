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
