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

// ============================================
// Theme Management
// ============================================

function initTheme() {
  // Check localStorage first, then system preference
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');

  setTheme(theme);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  // Update theme toggle icon
  const icon = $('btnThemeToggle').querySelector('i');
  if (theme === 'dark') {
    icon.className = 'ti ti-sun';
  } else {
    icon.className = 'ti ti-moon';
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
}

// ============================================
// Avatar Generation
// ============================================

function getInitials(name) {
  if (!name || name.trim() === '') return '??';

  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function updateUserAvatar() {
  const avatar = $('userAvatar');
  avatar.textContent = getInitials(identity.displayName);
}

// ============================================
// Modal Management
// ============================================

function openConnectionModal() {
  $('connectionModal').classList.remove('hidden');
  // Reset modal state
  $('connectionChoice').classList.remove('hidden');
  $('initiatorFlow').classList.add('hidden');
  $('joinerFlow').classList.add('hidden');
}

function closeConnectionModal() {
  $('connectionModal').classList.add('hidden');
  // Reset all flows
  $('connectionChoice').classList.remove('hidden');
  $('initiatorFlow').classList.add('hidden');
  $('joinerFlow').classList.add('hidden');
  $('joinerAnswerStep').classList.add('hidden');

  // Clear inputs
  $('offerInput').value = '';
  $('answerInput').value = '';
}

// Close modal when clicking outside
$('connectionModal').addEventListener('click', (e) => {
  if (e.target === $('connectionModal')) {
    closeConnectionModal();
  }
});

// ============================================
// Mobile Menu
// ============================================

function toggleMobileMenu() {
  $('sidebar').classList.toggle('mobile-open');
}

// Show mobile menu button on small screens
function updateMobileMenuVisibility() {
  const mobileMenuBtn = $('btnMobileMenu');
  if (window.innerWidth <= 768) {
    mobileMenuBtn.classList.remove('hidden');
  } else {
    mobileMenuBtn.classList.add('hidden');
    $('sidebar').classList.remove('mobile-open');
  }
}

window.addEventListener('resize', updateMobileMenuVisibility);
updateMobileMenuVisibility();

// ============================================
// Display Identity
// ============================================

$('displayName').textContent = identity.displayName;
$('userUUID').textContent = identity.uuid.substring(0, 16) + '...';
updateUserAvatar();

// ============================================
// Mesh Event Handlers
// ============================================

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
  const peerData = mesh.peers.get(uuid);
  // Only show system message if peer changed their own name (not custom rename)
  if (peerData) {
    addMessage(`${displayName} changed their display name`, 'system');
  }
  updatePeersList();
};

mesh.onMessage = (uuid, displayName, text) => {
  const peerName = identity.getPeerDisplayName(uuid, displayName);
  addMessage(`${peerName}: ${text}`, 'peer', uuid);
};

// ============================================
// Update Peers List UI
// ============================================

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
    .map((peer) => {
      // Determine latency badge class
      let latencyClass = 'latency-excellent';
      let latencyText = 'Unknown';
      if (peer.latency !== null && peer.latency !== undefined) {
        latencyText = `${peer.latency}ms`;
        if (peer.latency < 100) latencyClass = 'latency-excellent';
        else if (peer.latency < 200) latencyClass = 'latency-good';
        else if (peer.latency < 500) latencyClass = 'latency-fair';
        else latencyClass = 'latency-poor';
      }

      // Format uptime
      const uptimeText = peer.uptime > 60 ? `${Math.floor(peer.uptime / 60)}m` : `${peer.uptime}s`;

      const initials = getInitials(peer.displayName);

      return `
        <div class="peer-item" data-uuid="${peer.uuid}">
          <div class="peer-tooltip">
            <div class="tooltip-row">
              <span class="tooltip-label">Original Name:</span>
              <span class="tooltip-value">${peer.originalDisplayName}</span>
            </div>
            ${peer.displayName !== peer.originalDisplayName ? `
            <div class="tooltip-row">
              <span class="tooltip-label">Your Rename:</span>
              <span class="tooltip-value">${peer.displayName}</span>
            </div>
            ` : ''}
            <div class="tooltip-row">
              <span class="tooltip-label">UUID:</span>
              <span class="tooltip-value">${peer.uuid.substring(0, 8)}</span>
            </div>
            <div class="tooltip-row">
              <span class="tooltip-label">Quality Score:</span>
              <span class="tooltip-value">${peer.quality}/100</span>
            </div>
            <div class="tooltip-row">
              <span class="tooltip-label">Uptime:</span>
              <span class="tooltip-value">${uptimeText}</span>
            </div>
          </div>
          <div class="peer-avatar">
            ${initials}
            <div class="peer-status"></div>
          </div>
          <div class="peer-info">
            <div class="peer-name" data-uuid="${peer.uuid}">
              <span>${peer.displayName}</span>
              <i class="ti ti-edit"></i>
            </div>
            <div class="peer-stats">
              <div class="peer-uuid">${peer.uuid.substring(0, 8)}...</div>
              ${peer.latency !== null && peer.latency !== undefined ?
                `<div class="latency-badge ${latencyClass}">${latencyText}</div>` : ''}
              <div class="quality-badge">${peer.quality}</div>
            </div>
          </div>
        </div>
      `;
    })
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

// ============================================
// Rename Peer Locally
// ============================================

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

// ============================================
// Edit Own Display Name
// ============================================

$('btnEditName').onclick = () => {
  const newName = prompt('Enter your new display name:', identity.displayName);
  if (newName && newName.trim()) {
    identity.setDisplayName(newName.trim());
    $('displayName').textContent = identity.displayName;
    updateUserAvatar();
    mesh.broadcastNameChange();
    addMessage(`You changed your name to ${identity.displayName}`, 'system');
  }
};

// Also allow clicking on the identity section
$('userIdentity').onclick = (e) => {
  // Don't trigger if clicking the edit button
  if (!e.target.closest('.btn-edit-identity')) {
    $('btnEditName').click();
  }
};

// ============================================
// Add Message to Chat
// ============================================

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

// ============================================
// Enable Chat
// ============================================

function enableChat() {
  $('messageInput').disabled = false;
  $('btnSend').disabled = false;
}

// ============================================
// Connection Event Handlers
// ============================================

$('btnNewConnection').onclick = () => {
  openConnectionModal();
};

$('btnCloseModal').onclick = () => {
  closeConnectionModal();
};

$('btnInvite').onclick = async () => {
  $('connectionChoice').classList.add('hidden');
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
  $('connectionChoice').classList.add('hidden');
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

    // Hide the modal after connection attempt
    setTimeout(() => {
      closeConnectionModal();
    }, 2000);
  } catch (e) {
    alert('Invalid response format: ' + e.message);
  }
};

// ============================================
// Send Message
// ============================================

$('btnSend').onclick = () => {
  const text = $('messageInput').value.trim();
  if (text && mesh.getConnectedPeers().length > 0) {
    mesh.sendMessage(text);
    addMessage(`You: ${text}`, 'sent');
    $('messageInput').value = '';

    // Close mobile menu if open
    if (window.innerWidth <= 768) {
      $('sidebar').classList.remove('mobile-open');
    }
  }
};

$('messageInput').onkeypress = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('btnSend').click();
  }
};

// ============================================
// Theme Toggle
// ============================================

$('btnThemeToggle').onclick = () => {
  toggleTheme();
};

// ============================================
// Mobile Menu Toggle
// ============================================

$('btnMobileMenu').onclick = () => {
  toggleMobileMenu();
};

// ============================================
// Initialization
// ============================================

// Initialize theme
initTheme();

// Disable send button initially
$('messageInput').disabled = true;
$('btnSend').disabled = true;

// Welcome message
addMessage('Welcome! Your identity has been created.', 'system');
addMessage('Click "New Connection" to connect to peers.', 'system');
