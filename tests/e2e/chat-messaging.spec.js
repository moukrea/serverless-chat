import { test, expect } from '@playwright/test';
import { createPeerContexts, cleanupPeerContexts } from './utils/peer-context.js';
import { manualPeerConnection, waitForPeerCount } from './utils/connection-helpers.js';
import {
  sendMessage,
  waitForMessage,
  getAllMessages,
  isInputEnabled
} from './utils/ui-helpers.js';

test.describe('Chat Messaging Tests', () => {
  let peerContexts = [];

  test.afterEach(async () => {
    await cleanupPeerContexts(peerContexts);
    peerContexts = [];
  });

  test('should enable message input after peer connection', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    const beforeConnection = await isInputEnabled(peer1.page);
    expect(beforeConnection).toBe(false);

    await manualPeerConnection(peer1.page, peer2.page);

    const afterConnection = await isInputEnabled(peer1.page);
    expect(afterConnection).toBe(true);
  });

  test('should send and receive messages between 2 peers', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    const testMessage = 'Hello from Peer 1!';
    await sendMessage(peer1.page, testMessage);

    await waitForMessage(peer2.page, testMessage);

    const peer2Messages = await getAllMessages(peer2.page);
    const receivedMessage = peer2Messages.find(msg => msg.text.includes(testMessage));

    expect(receivedMessage).toBeTruthy();
    expect(receivedMessage.text).toBe(testMessage);
  });

  test('should broadcast messages to all peers in mesh', async ({ browser }) => {
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

    await waitForPeerCount(peer2.page, 2, 35000);
    await waitForPeerCount(peer3.page, 2, 35000);

    const testMessage = 'Broadcast message from Peer 1';
    await sendMessage(peer1.page, testMessage);

    await Promise.all([
      waitForMessage(peer2.page, testMessage, 15000),
      waitForMessage(peer3.page, testMessage, 15000)
    ]);

    const peer2Messages = await getAllMessages(peer2.page);
    const peer3Messages = await getAllMessages(peer3.page);

    const peer2Received = peer2Messages.find(msg => msg.text.includes(testMessage));
    const peer3Received = peer3Messages.find(msg => msg.text.includes(testMessage));

    expect(peer2Received).toBeTruthy();
    expect(peer3Received).toBeTruthy();
  });

  test('should handle bidirectional messaging', async ({ browser }) => {
    peerContexts = await createPeerContexts(browser, 2);
    const [peer1, peer2] = peerContexts;

    await peer1.goto('/', { waitUntil: 'domcontentloaded' });
    await peer2.goto('/', { waitUntil: 'domcontentloaded' });

    await peer1.page.waitForSelector('#messageInput');
    await peer2.page.waitForSelector('#messageInput');

    await manualPeerConnection(peer1.page, peer2.page);

    const message1to2 = 'Hello from Peer 1';
    const message2to1 = 'Hello from Peer 2';

    await sendMessage(peer1.page, message1to2);
    await waitForMessage(peer2.page, message1to2);

    await sendMessage(peer2.page, message2to1);
    await waitForMessage(peer1.page, message2to1);

    const peer1Messages = await getAllMessages(peer1.page);
    const peer2Messages = await getAllMessages(peer2.page);

    const peer1Received = peer1Messages.find(msg => msg.text.includes(message2to1));
    const peer2Received = peer2Messages.find(msg => msg.text.includes(message1to2));

    expect(peer1Received).toBeTruthy();
    expect(peer2Received).toBeTruthy();
  });
});
