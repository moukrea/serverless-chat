import path from 'path';
import fs from 'fs';

export class PeerContext {
  constructor(browser, peerId) {
    this.browser = browser;
    this.peerId = peerId;
    this.context = null;
    this.page = null;
    this.userDataDir = path.join(process.cwd(), '.temp', `peer-${peerId}`);
  }

  async initialize({ usePersistentContext = false, storageState = null } = {}) {
    const contextOptions = {
      viewport: { width: 1280, height: 720 },
      permissions: ['clipboard-read', 'clipboard-write']
    };

    if (storageState) {
      contextOptions.storageState = storageState;
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    return this.page;
  }

  async saveStorageState(filePath) {
    if (!this.context) {
      throw new Error('Context not initialized');
    }
    await this.context.storageState({ path: filePath });
  }

  async goto(url) {
    if (!this.page) {
      throw new Error('Page not initialized');
    }
    await this.page.goto(url);
  }

  async close() {
    if (this.context) {
      await this.context.close();
    }
  }

  async cleanup() {
    await this.close();
    if (fs.existsSync(this.userDataDir)) {
      fs.rmSync(this.userDataDir, { recursive: true, force: true });
    }
  }
}

export async function createPeerContexts(browser, count, options = {}) {
  const peers = [];

  for (let i = 0; i < count; i++) {
    const peerId = options.peerIds?.[i] || `peer${i + 1}`;
    const peer = new PeerContext(browser, peerId);
    await peer.initialize(options);
    peers.push(peer);
  }

  return peers;
}

export async function cleanupPeerContexts(peerContexts) {
  await Promise.all(peerContexts.map(peer => peer.cleanup()));
}
