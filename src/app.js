import process from 'process';
window.process = process;
globalThis.process = process;

import Identity from './identity.js';
import MeshNetwork from './mesh.js';
import './styles/main.css';

// Initialize identity and mesh network
const identity = new Identity();
const mesh = new MeshNetwork(identity);

// Helper function
const $ = (id) => document.getElementById(id);

// Display identity
$('displayName').textContent = identity.displayName;
$('userUUID').textContent = identity.uuid;

// Setup mesh event handlers
mesh.onPeerConnect = (uuid, displayName) => {
  addMessage(`${displayName} joined the mesh`, 'system');
  updatePeersList();
  enableChat();
};

mesh.onPeerDisconnect = (uuid) => {
  const displayName = identity.getPeerDisplayName(uuid, 'Peer');
  addMessage(`${displayName} left the mesh`, 'system');
  updatePeersList();
};

mesh.onPeerUpdate = (uuid, displayName) => {
  addMessage(`Peer renamed to ${displayName}`, 'system');
  updatePeersList();
};

mesh.onMessage = (uuid, displayName, text) => {
  const peerName = identity.getPeerDisplayName(uuid, displayName);
  addMessage(`${peerName}: ${text}`, 'peer', uuid);
};

// Update peers list UI
function updatePeersList() {
  const peers = mesh.getConnectedPeers();
  const peersList = $('peersList');
  const peerCount = $('peerCount');

  peerCount.textContent = peers.length;

  if (peers.length === 0) {
    peersList.innerHTML = '<div class="no-peers">No peers connected yet</div>';
    return;
  }

  peersList.innerHTML = peers
    .map(
      (peer) => `
    <div class="peer-item" data-uuid="${peer.uuid}">
      <div class="peer-status"></div>
      <div class="peer-info">
        <div class="peer-name" data-uuid="${peer.uuid}">
          <span>${peer.displayName}</span>
          <i class="ti ti-edit"></i>
        </div>
        <div class="peer-uuid">${peer.uuid.substring(0, 16)}...</div>
      </div>
    </div>
  `
    )
    .join('');

  // Add click handlers for renaming
  peersList.querySelectorAll('.peer-name').forEach((el) => {
    el.addEventListener('click', () => {
      const uuid = el.dataset.uuid;
      const peer = peers.find((p) => p.uuid === uuid);
      if (peer) {
        renamePeer(uuid, peer.displayName, peer.originalDisplayName);
      }
    });
  });
}

// Rename peer locally
function renamePeer(uuid, currentName, originalName) {
  const newName = prompt(
    `Rename peer locally:\n\nOriginal name: ${originalName}\nCurrent custom name: ${currentName === originalName ? '(none)' : currentName}`,
    currentName
  );

  if (newName !== null && newName.trim()) {
    if (newName === originalName) {
      // Reset to original name
      identity.setPeerRename(uuid, '');
    } else {
      identity.setPeerRename(uuid, newName);
    }
    updatePeersList();
  }
}

// Edit own display name
$('btnEditName').onclick = () => {
  const newName = prompt('Enter your new display name:', identity.displayName);
  if (newName && newName.trim()) {
    identity.setDisplayName(newName.trim());
    $('displayName').textContent = identity.displayName;
    mesh.broadcastNameChange();
    addMessage(`You changed your name to ${identity.displayName}`, 'system');
  }
};

// Also allow clicking on the name itself
$('displayName').onclick = () => $('btnEditName').click();

// Add message to chat
function addMessage(text, type = 'sent', uuid = null) {
  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.textContent = text;
  if (uuid) {
    div.dataset.uuid = uuid;
  }
  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
}

// Enable chat when at least one peer connected
function enableChat() {
  $('messageInput').disabled = false;
  $('btnSend').disabled = false;
}

// Event Handlers
$('btnInvite').onclick = async () => {
  $('btnInvite').disabled = true;
  $('initiatorFlow').classList.remove('hidden');

  // Show loader
  $('offerLoader').classList.remove('hidden');
  $('offerOutput').classList.add('hidden');
  $('btnCopyOffer').classList.add('hidden');

  const offer = await mesh.createOffer();

  // Hide loader, show code
  $('offerLoader').classList.add('hidden');
  $('offerOutput').value = offer;
  $('offerOutput').classList.remove('hidden');
  $('btnCopyOffer').classList.remove('hidden');

  addMessage('Invitation generated. Waiting for peer to respond...', 'system');

  // Allow creating more invitations
  setTimeout(() => {
    $('btnInvite').disabled = false;
  }, 1000);
};

$('btnJoin').onclick = () => {
  $('btnJoin').disabled = true;
  $('joinerFlow').classList.remove('hidden');

  // Allow joining more
  setTimeout(() => {
    $('btnJoin').disabled = false;
  }, 1000);
};

$('btnCopyOffer').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('offerOutput').value);
    $('btnCopyOffer').innerHTML = '<i class="ti ti-check"></i><span>Copied!</span>';
    setTimeout(() => {
      $('btnCopyOffer').innerHTML = '<i class="ti ti-copy"></i><span>Copy Code</span>';
    }, 2000);
  } catch (e) {
    $('offerOutput').select();
    alert('Please copy manually (Ctrl+C)');
  }
};

$('btnProcessOffer').onclick = async () => {
  const offer = $('offerInput').value.trim();
  if (!offer) {
    alert('Please paste an offer');
    return;
  }

  try {
    // Show joiner answer step with loader
    $('joinerAnswerStep').classList.remove('hidden');
    $('answerLoader').classList.remove('hidden');
    $('answerOutput').classList.add('hidden');
    $('btnCopyAnswer').classList.add('hidden');

    const answer = await mesh.acceptOffer(offer);

    // Hide loader, show code
    $('answerLoader').classList.add('hidden');
    $('answerOutput').value = answer;
    $('answerOutput').classList.remove('hidden');
    $('btnCopyAnswer').classList.remove('hidden');

    addMessage('Response generated. Share it with the inviter...', 'system');

    // Clear and allow more
    setTimeout(() => {
      $('offerInput').value = '';
      $('joinerAnswerStep').classList.add('hidden');
    }, 30000); // Clear after 30 seconds
  } catch (e) {
    alert('Invalid offer format');
  }
};

$('btnCopyAnswer').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('answerOutput').value);
    $('btnCopyAnswer').innerHTML = '<i class="ti ti-check"></i><span>Copied!</span>';
    setTimeout(() => {
      $('btnCopyAnswer').innerHTML = '<i class="ti ti-copy"></i><span>Copy Code</span>';
    }, 2000);
  } catch (e) {
    $('answerOutput').select();
    alert('Please copy manually (Ctrl+C)');
  }
};

$('btnAcceptAnswer').onclick = () => {
  const answer = $('answerInput').value.trim();
  if (!answer) {
    alert('Please paste a response');
    return;
  }

  try {
    mesh.acceptAnswer(answer);
    addMessage('Processing response... connecting to peer...', 'system');

    // Clear the input
    $('answerInput').value = '';

    // Hide the flow after connection attempt
    setTimeout(() => {
      $('initiatorFlow').classList.add('hidden');
    }, 2000);
  } catch (e) {
    alert('Invalid response format: ' + e.message);
  }
};

// Send message
$('btnSend').onclick = () => {
  const text = $('messageInput').value.trim();
  if (text && mesh.getConnectedPeers().length > 0) {
    mesh.sendMessage(text);
    addMessage(`You: ${text}`, 'sent');
    $('messageInput').value = '';
  }
};

$('messageInput').onkeypress = (e) => {
  if (e.key === 'Enter') {
    $('btnSend').click();
  }
};

// Disable send button initially
$('messageInput').disabled = true;
$('btnSend').disabled = true;

// Welcome message
addMessage('Welcome! Your identity has been created.', 'system');
addMessage('Create an invitation or join with a code to connect to peers.', 'system');
