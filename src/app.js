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

function openMobileMenu() {
  const sidebar = $('sidebar');
  const overlay = $('sidebarOverlay');

  sidebar.classList.add('mobile-open');
  overlay.classList.add('active');
  document.body.classList.add('sidebar-open');

  // Accessibility
  sidebar.setAttribute('aria-hidden', 'false');
}

function closeMobileMenu() {
  const sidebar = $('sidebar');
  const overlay = $('sidebarOverlay');

  sidebar.classList.remove('mobile-open');
  overlay.classList.remove('active');
  document.body.classList.remove('sidebar-open');

  // Accessibility
  sidebar.setAttribute('aria-hidden', 'true');
}

function toggleMobileMenu() {
  const sidebar = $('sidebar');
  if (sidebar.classList.contains('mobile-open')) {
    closeMobileMenu();
  } else {
    openMobileMenu();
  }
}

// Show mobile menu button on small screens
function updateMobileMenuVisibility() {
  const mobileMenuBtn = $('btnMobileMenu');
  if (window.innerWidth <= 768) {
    mobileMenuBtn.classList.remove('hidden');
  } else {
    mobileMenuBtn.classList.add('hidden');
    closeMobileMenu(); // Use new close function
  }
}

window.addEventListener('resize', updateMobileMenuVisibility);
updateMobileMenuVisibility();

// Close sidebar with ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('sidebar').classList.contains('mobile-open')) {
    closeMobileMenu();
  }
});

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
// Message Formatting Helpers
// ============================================

function formatTimestamp() {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const messageDate = new Date(now);
  messageDate.setHours(0, 0, 0, 0);

  // Format time (always shown)
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const time = `${hours}:${minutes}`;

  // If not today, add date
  if (messageDate.getTime() !== today.getTime()) {
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const year = now.getFullYear();
    return `${month}/${day}/${year} ${time}`;
  }

  return time;
}

function createMessageAvatar(author, type) {
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';

  if (type === 'peer') {
    avatar.classList.add('peer-avatar-msg');
  }

  avatar.textContent = getInitials(author);
  return avatar;
}

// ============================================
// Add Message to Chat
// ============================================

function addMessage(text, type = 'sent', uuid = null) {
  const messagesContainer = $('messages');

  // System messages - keep simple centered format
  if (type === 'system') {
    const div = document.createElement('div');
    div.className = 'message system';
    div.textContent = text;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return;
  }

  // Parse author and message text
  let author = 'Unknown';
  let messageText = text;

  // Check if text contains "Author: message" format
  const colonIndex = text.indexOf(': ');
  if (colonIndex > 0) {
    author = text.substring(0, colonIndex);
    messageText = text.substring(colonIndex + 2);
  }

  // Create message group
  const messageGroup = document.createElement('div');
  messageGroup.className = 'message-group';
  if (uuid) {
    messageGroup.dataset.uuid = uuid;
  }

  // Create avatar
  const avatar = createMessageAvatar(author, type);

  // Create message content container
  const content = document.createElement('div');
  content.className = 'message-content';

  // Create message header (author + timestamp)
  const header = document.createElement('div');
  header.className = 'message-header';

  const authorSpan = document.createElement('span');
  authorSpan.className = 'message-author';
  authorSpan.textContent = author;

  const timestamp = document.createElement('span');
  timestamp.className = 'message-timestamp';
  timestamp.textContent = formatTimestamp();

  header.appendChild(authorSpan);
  header.appendChild(timestamp);

  // Create message text
  const textDiv = document.createElement('div');
  textDiv.className = 'message-text';
  textDiv.textContent = messageText;

  // Assemble message
  content.appendChild(header);
  content.appendChild(textDiv);

  messageGroup.appendChild(avatar);
  messageGroup.appendChild(content);

  messagesContainer.appendChild(messageGroup);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
      closeMobileMenu();
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

// Close sidebar when clicking overlay
$('sidebarOverlay').addEventListener('click', () => {
  closeMobileMenu();
});

// Close sidebar with close button
$('btnCloseSidebar').addEventListener('click', () => {
  closeMobileMenu();
});

// ============================================
// PWA Install Manager
// ============================================

class PWAInstallManager {
  constructor() {
    this.deferredPrompt = null;
    this.installButton = $('btnInstallApp');
    this.isInstalled = this.checkIfInstalled();

    this.init();
  }

  checkIfInstalled() {
    // Check if running in standalone mode (installed as PWA)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = window.navigator.standalone === true;

    return isStandalone || isIOSStandalone;
  }

  init() {
    // If already installed, keep button hidden
    if (this.isInstalled) {
      console.log('PWA is already installed');
      return;
    }

    // Listen for the beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('beforeinstallprompt event fired');

      // Prevent the default browser install prompt
      e.preventDefault();

      // Store the event for later use
      this.deferredPrompt = e;

      // Show the install button with pulse animation
      this.showInstallButton();
    });

    // Listen for successful installation
    window.addEventListener('appinstalled', () => {
      console.log('PWA installed successfully');
      this.handleInstallSuccess();
    });

    // Handle install button click
    this.installButton.addEventListener('click', () => {
      this.handleInstallClick();
    });

    // Check if already installable (rare case where event fired before class init)
    if (this.deferredPrompt) {
      this.showInstallButton();
    }
  }

  showInstallButton() {
    this.installButton.classList.remove('hidden');
    this.installButton.classList.add('pulse');

    // Remove pulse after a few cycles (6 seconds = 3 complete pulses)
    setTimeout(() => {
      this.installButton.classList.remove('pulse');
    }, 6000);
  }

  hideInstallButton() {
    this.installButton.classList.add('hidden');
    this.installButton.classList.remove('pulse', 'installing', 'success', 'error');
  }

  async handleInstallClick() {
    if (!this.deferredPrompt) {
      console.error('No deferred prompt available');
      this.showError('Installation not available');
      return;
    }

    try {
      // Show installing state
      this.installButton.classList.remove('pulse');
      this.installButton.classList.add('installing');
      this.updateButtonContent('ti ti-loader', 'Installing...');

      // Show the install prompt
      this.deferredPrompt.prompt();

      // Wait for user response
      const { outcome } = await this.deferredPrompt.userChoice;

      console.log(`User response to install prompt: ${outcome}`);

      if (outcome === 'accepted') {
        // Show success state temporarily
        this.installButton.classList.remove('installing');
        this.installButton.classList.add('success');
        this.updateButtonContent('ti ti-check', 'Installed!');

        // Hide button after 2 seconds
        setTimeout(() => {
          this.hideInstallButton();
        }, 2000);
      } else {
        // User dismissed the prompt
        this.installButton.classList.remove('installing');
        this.updateButtonContent('ti ti-download', 'Install App');

        // Add pulse back to encourage retry
        setTimeout(() => {
          this.installButton.classList.add('pulse');
        }, 500);
      }

      // Clear the deferred prompt
      this.deferredPrompt = null;

    } catch (error) {
      console.error('Error during installation:', error);
      this.showError('Installation failed');
    }
  }

  showError(message) {
    this.installButton.classList.remove('installing', 'success');
    this.installButton.classList.add('error');
    this.updateButtonContent('ti ti-alert-circle', message);

    // Reset after 2 seconds
    setTimeout(() => {
      this.installButton.classList.remove('error');
      this.updateButtonContent('ti ti-download', 'Install App');

      // If prompt is still available, add pulse back
      if (this.deferredPrompt) {
        this.installButton.classList.add('pulse');
      }
    }, 2000);
  }

  handleInstallSuccess() {
    // Show success state
    this.installButton.classList.remove('installing', 'pulse');
    this.installButton.classList.add('success');
    this.updateButtonContent('ti ti-check', 'Installed!');

    addMessage('App installed successfully! You can now use it offline.', 'system');

    // Hide button after 2 seconds
    setTimeout(() => {
      this.hideInstallButton();
    }, 2000);
  }

  updateButtonContent(iconClass, text) {
    const icon = this.installButton.querySelector('i');
    const span = this.installButton.querySelector('span');

    if (icon) icon.className = iconClass;
    if (span) span.textContent = text;
  }
}

// ============================================
// Initialization
// ============================================

// Initialize theme
initTheme();

// Initialize PWA Install Manager
const pwaInstallManager = new PWAInstallManager();

// Disable send button initially
$('messageInput').disabled = true;
$('btnSend').disabled = true;

// Welcome message
addMessage('Welcome! Your identity has been created.', 'system');
addMessage('Click "New Connection" to connect to peers.', 'system');
