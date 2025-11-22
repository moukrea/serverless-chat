export async function sendMessage(page, messageText) {
  await page.fill('#messageInput', messageText);
  await page.click('#btnSend');
}

export async function getLastMessage(page) {
  return await page.evaluate(() => {
    const messages = document.querySelectorAll('.message-group .message-text');
    if (messages.length === 0) {
      const systemMessages = document.querySelectorAll('.message.system');
      return systemMessages.length > 0 ? systemMessages[systemMessages.length - 1].textContent : null;
    }
    return messages[messages.length - 1].textContent;
  });
}

export async function getAllMessages(page) {
  return await page.evaluate(() => {
    const messages = [];

    const messageGroups = document.querySelectorAll('.message-group');
    messageGroups.forEach(group => {
      const author = group.querySelector('.message-author')?.textContent || 'Unknown';
      const text = group.querySelector('.message-text')?.textContent || '';
      messages.push({ type: 'user', author, text });
    });

    const systemMessages = document.querySelectorAll('.message.system');
    systemMessages.forEach(msg => {
      messages.push({ type: 'system', text: msg.textContent });
    });

    return messages;
  });
}

export async function waitForMessage(page, expectedText, timeout = 10000) {
  await page.waitForFunction(
    (text) => {
      const messages = document.querySelectorAll('.message-text');
      return Array.from(messages).some(msg => msg.textContent.includes(text));
    },
    expectedText,
    { timeout }
  );
}

export async function changeDisplayName(page, newName) {
  await page.click('#btnEditName');

  await page.waitForTimeout(500);

  await page.evaluate((name) => {
    const input = document.querySelector('input[type="text"]');
    if (input) {
      input.value = name;
      const form = input.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit'));
      }
    }
  }, newName);

  await page.waitForTimeout(500);
}

export async function clickEditDisplayName(page) {
  await page.click('#btnEditName');
}

export async function setDisplayNameViaPrompt(page, newName) {
  page.once('dialog', async dialog => {
    await dialog.accept(newName);
  });

  await page.click('#btnEditName');

  await page.waitForTimeout(500);
}

export async function getDisplayedUserName(page) {
  return await page.textContent('#displayName');
}

export async function getPeersList(page) {
  return await page.evaluate(() => {
    const peerItems = document.querySelectorAll('.peer-item');
    const peers = [];

    peerItems.forEach(item => {
      const uuid = item.getAttribute('data-uuid');
      const name = item.querySelector('.peer-name')?.textContent || '';
      const latency = item.querySelector('.latency-badge')?.textContent || '';

      peers.push({ uuid, name, latency });
    });

    return peers;
  });
}

export async function renamePeer(page, peerUuid, newName) {
  page.once('dialog', async dialog => {
    await dialog.accept(newName);
  });

  await page.click(`.peer-name[data-uuid="${peerUuid}"]`);

  await page.waitForTimeout(500);
}

export async function getPeerDisplayName(page, peerUuid) {
  return await page.evaluate((uuid) => {
    const peerElement = document.querySelector(`.peer-name[data-uuid="${uuid}"]`);
    return peerElement ? peerElement.textContent.trim() : null;
  }, peerUuid);
}

export async function waitForPeerInList(page, expectedCount, timeout = 10000) {
  await page.waitForFunction(
    (count) => {
      const peerItems = document.querySelectorAll('.peer-item');
      return peerItems.length >= count;
    },
    expectedCount,
    { timeout }
  );
}

export async function openConnectionModal(page) {
  await page.click('#btnNewConnection');
}

export async function closeConnectionModal(page) {
  await page.click('#btnCloseModal');
}

export async function isInputEnabled(page) {
  return await page.evaluate(() => {
    const input = document.querySelector('#messageInput');
    return input && !input.disabled;
  });
}

export async function getPeerCount(page) {
  return await page.evaluate(() => {
    const peerCountElement = document.querySelector('#peerCount');
    return peerCountElement ? parseInt(peerCountElement.textContent, 10) : 0;
  });
}
