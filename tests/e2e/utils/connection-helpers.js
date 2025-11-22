export async function waitForPeerConnection(page, timeout = 30000) {
  await page.waitForFunction(
    () => {
      const mesh = window.mesh;
      return mesh && mesh.peers && mesh.peers.size > 0;
    },
    { timeout }
  );
}

export async function waitForPeerCount(page, expectedCount, timeout = 30000) {
  await page.waitForFunction(
    (count) => {
      const mesh = window.mesh;
      return mesh && mesh.peers && mesh.peers.size >= count;
    },
    expectedCount,
    { timeout }
  );
}

export async function getConnectedPeerCount(page) {
  return await page.evaluate(() => {
    const mesh = window.mesh;
    return mesh && mesh.peers ? mesh.peers.size : 0;
  });
}

export async function getConnectedPeers(page) {
  return await page.evaluate(() => {
    const mesh = window.mesh;
    if (!mesh || !mesh.peers) return [];

    const peers = [];
    for (const [uuid, peerData] of mesh.peers.entries()) {
      peers.push({
        uuid,
        displayName: peerData.displayName,
        status: peerData.status,
        latency: peerData.latency
      });
    }
    return peers;
  });
}

export async function getPeerUUID(page) {
  return await page.evaluate(() => {
    const identity = window.identity;
    return identity ? identity.uuid : null;
  });
}

export async function getDisplayName(page) {
  return await page.evaluate(() => {
    const identity = window.identity;
    return identity ? identity.displayName : null;
  });
}

export async function waitForMeshInitialization(page, timeout = 10000) {
  await page.waitForFunction(
    () => {
      return window.mesh && typeof window.mesh.createOffer === 'function';
    },
    { timeout }
  );
}

export async function createOfferOnPage(page) {
  await waitForMeshInitialization(page);
  return await page.evaluate(async () => {
    return await window.mesh.createOffer();
  });
}

export async function acceptOfferOnPage(page, offer) {
  await waitForMeshInitialization(page);
  return await page.evaluate(async (offerData) => {
    return await window.mesh.acceptOffer(offerData);
  }, offer);
}

export async function acceptAnswerOnPage(page, answer) {
  await waitForMeshInitialization(page);
  await page.evaluate(async (answerData) => {
    await window.mesh.acceptAnswer(answerData);
  }, answer);
}

export async function manualPeerConnection(pageA, pageB) {
  const offer = await createOfferOnPage(pageA);
  const answer = await acceptOfferOnPage(pageB, offer);
  await acceptAnswerOnPage(pageA, answer);

  await Promise.all([
    waitForPeerConnection(pageA),
    waitForPeerConnection(pageB)
  ]);
}

export async function waitForReconnection(page, timeout = 40000) {
  await page.waitForFunction(
    () => {
      const mesh = window.mesh;
      return mesh && mesh.peers && mesh.peers.size > 0;
    },
    { timeout }
  );
}

export async function triggerReconnection(page) {
  await page.evaluate(async () => {
    if (window.mesh && window.mesh.reconnectToMesh) {
      return await window.mesh.reconnectToMesh();
    }
  });
}
