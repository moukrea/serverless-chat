import Identity from './identity.js';
import MeshNetwork from './mesh.js';
import MarkdownInput from './components/markdown-input.js';
import { renderMarkdown, renderStyledMarkdown, detectMarkdownSyntax } from './utils/markdown-renderer.js';
import './styles/main.css';
import './styles/markdown.css';

// Initialize identity and mesh network
const identity = new Identity();
const mesh = new MeshNetwork(identity);

// Expose for testing/debugging
window.mesh = mesh;
window.identity = identity;

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

mesh.onMessage = (uuid, displayName, text, format) => {
  const peerName = identity.getPeerDisplayName(uuid, displayName);
  addMessage(`${peerName}: ${text}`, 'peer', uuid, format);
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

function addMessage(text, type = 'sent', uuid = null, format = 'plain') {
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
  if (format) {
    messageGroup.dataset.format = format;
    messageGroup.dataset.rawText = messageText;
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

  if (format === 'markdown' && detectMarkdownSyntax(messageText)) {
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-toggle-raw';
    toggleBtn.setAttribute('aria-label', 'Toggle raw markdown');
    toggleBtn.setAttribute('title', 'View raw markdown');
    toggleBtn.innerHTML = '<i class="ti ti-code"></i>';
    toggleBtn.addEventListener('click', () => toggleMessageView(messageGroup));
    header.appendChild(toggleBtn);
  }

  // Create message text
  const textDiv = document.createElement('div');
  textDiv.className = 'message-text';

  if (format === 'markdown') {
    try {
      const renderedHtml = renderMarkdown(messageText);
      textDiv.innerHTML = renderedHtml;
      textDiv.classList.add('markdown-rendered');
    } catch (error) {
      console.error('[App] Markdown rendering error:', error);
      textDiv.textContent = messageText;
    }
  } else {
    textDiv.textContent = messageText;
  }

  // Assemble message
  content.appendChild(header);
  content.appendChild(textDiv);

  messageGroup.appendChild(avatar);
  messageGroup.appendChild(content);

  messagesContainer.appendChild(messageGroup);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function toggleMessageView(messageGroup) {
  const textDiv = messageGroup.querySelector('.message-text');
  const rawText = messageGroup.dataset.rawText;
  const toggleBtn = messageGroup.querySelector('.btn-toggle-raw');

  if (!textDiv || !rawText || !toggleBtn) return;

  const isShowingRaw = textDiv.classList.contains('showing-raw');

  if (isShowingRaw) {
    const renderedHtml = renderMarkdown(rawText);
    textDiv.innerHTML = renderedHtml;
    textDiv.classList.remove('showing-raw', 'styled-markdown');
    textDiv.classList.add('markdown-rendered');
    toggleBtn.innerHTML = '<i class="ti ti-code"></i>';
    toggleBtn.setAttribute('title', 'View raw markdown');
  } else {
    const styledHtml = renderStyledMarkdown(rawText);
    textDiv.innerHTML = styledHtml;
    textDiv.classList.add('showing-raw', 'styled-markdown');
    textDiv.classList.remove('markdown-rendered');
    toggleBtn.innerHTML = '<i class="ti ti-eye"></i>';
    toggleBtn.setAttribute('title', 'View rendered markdown');
  }
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

$('btnClearData').onclick = () => {
  if (confirm('Are you sure you want to clear ALL data? This will:\n\n• Delete your identity\n• Delete all saved peers\n• Delete all reconnection data\n• Clear all settings\n\nThis action cannot be undone. The page will reload after clearing.')) {
    try {
      const itemCount = localStorage.length;
      localStorage.clear();

      addMessage(`All data cleared (${itemCount} items). Reloading...`, 'system');

      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('[App] Error clearing data:', error);
      alert('Error clearing data: ' + error.message);
    }
  }
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

let markdownInput;

$('btnSend').onclick = () => {
  const text = $('messageInput').value.trim();
  if (text && mesh.getConnectedPeers().length > 0) {
    mesh.sendMessage(text, 'markdown');
    addMessage(`You: ${text}`, 'sent', null, 'markdown');
    $('messageInput').value = '';
    if (markdownInput) {
      markdownInput.clearPreview();
    }

    // Close mobile menu if open
    if (window.innerWidth <= 768) {
      closeMobileMenu();
    }
  }
};

$('messageInput').addEventListener('keydown', (e) => {
  const isMobile = window.innerWidth <= 768;

  if (e.key === 'Enter') {
    if (isMobile) {
      return;
    }

    if (!e.shiftKey) {
      e.preventDefault();
      $('btnSend').click();
    }
  }
});

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
      return;
    }

    // Listen for the beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent the default browser install prompt
      e.preventDefault();

      // Store the event for later use
      this.deferredPrompt = e;

      // Show the install button with pulse animation
      this.showInstallButton();
    });

    // Listen for successful installation
    window.addEventListener('appinstalled', () => {
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
// Service Worker Update Handler
// ============================================

// Listen for service worker updates and reload the page
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Show notification before reload (optional)
    addMessage('New version installed. Reloading...', 'system');

    // Force reload to get new code
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  });
}

// ============================================
// Automatic Reconnection
// ============================================

async function initializeReconnection() {
  const startTime = Date.now();

  try {
    // Wait for reconnection system initialization if not ready
    if (!mesh.reconnectionReady) {
      try {
        await mesh._initPromise;
      } catch (error) {
        console.error('[App] Reconnection system initialization failed:', error);
        addMessage('Reconnection system unavailable. Click "New Connection" to connect.', 'system');
        return;
      }
    }

    // Verify reconnection system is properly initialized
    if (!mesh.reconnectionEnabled || !mesh.masterReconnect) {
      addMessage('Reconnection disabled. Click "New Connection" to connect.', 'system');
      return;
    }

    // Check if we're online before attempting reconnection
    if (!navigator.onLine) {
      addMessage('You are offline. Reconnection will start when back online.', 'system');
      return;
    }

    // Show reconnection progress
    addMessage('Reconnecting to mesh network...', 'system');

    // Attempt reconnection
    const reconnectStart = Date.now();
    const result = await mesh.reconnectToMesh();
    const reconnectTime = Date.now() - reconnectStart;

    if (result.fallbackRequired || result.method === 'cold_start_failed') {
      // All automatic reconnection failed, show manual pairing UI
      const totalTime = Date.now() - startTime;
      addMessage('No saved connections found. Click "New Connection" to connect.', 'system');
    } else if (result.peersConnected > 0) {
      // Successfully reconnected
      const totalTime = Date.now() - startTime;
      const timeStr = reconnectTime < 1000 ? `${reconnectTime}ms` : `${(reconnectTime / 1000).toFixed(1)}s`;

      let methodStr = '';
      if (result.method === 'mesh_relay' || result.method === 'warm_reconnection') {
        methodStr = ' via mesh relay';
      } else if (result.method === 'direct_cached') {
        methodStr = ' directly';
      } else if (result.method === 'cold_start') {
        methodStr = ' from cold start';
      }

      addMessage(`Reconnected to ${result.peersConnected} peer(s)${methodStr} (${timeStr})`, 'system');

      // Enable UI
      $('messageInput').disabled = false;
      $('btnSend').disabled = false;
    } else {
      // No peers to reconnect to
      const totalTime = Date.now() - startTime;
      addMessage('No saved connections. Click "New Connection" to connect.', 'system');
    }
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[App] Reconnection failed after ${totalTime}ms:`, error);
    addMessage('Reconnection error. Click "New Connection" to connect manually.', 'system');
  }
}

// Debug utilities
window.showReconnectionStats = () => {
  const stats = mesh.getReconnectionStats();
  if (!stats) {
    return;
  }

  const output = [];
  output.push('='.repeat(50));
  output.push('RECONNECTION SYSTEM STATISTICS');
  output.push('='.repeat(50));

  if (stats.master) {
    output.push('\nMaster Strategy:');
    output.push('  Total attempts: ' + stats.master.totalReconnectionAttempts);
    output.push('  Successful: ' + stats.master.successfulReconnections);
    output.push('  Failed: ' + stats.master.failedReconnections);
    output.push('  Success rate: ' + (
      stats.master.totalReconnectionAttempts > 0
        ? `${((stats.master.successfulReconnections / stats.master.totalReconnectionAttempts) * 100).toFixed(1)}%`
        : 'N/A'
    ));
  }

  if (stats.persistence) {
    output.push('\nPersistence:');
    output.push('  Total saved peers: ' + stats.persistence.totalPeers);
    output.push('  Needs cleanup: ' + stats.persistence.needsCleanup);
  }

  if (stats.network) {
    output.push('\nNetwork:');
    output.push('  IP changes: ' + stats.network.ipChangeCount);
    output.push('  Connection type: ' + stats.network.currentConnectionType);
    output.push('  Online: ' + stats.network.isOnline);
  }

  output.push('\n' + '='.repeat(50));
  return output.join('\n');
};

async function showSavedPeers() {
  if (!mesh.peerPersistence) {
    return 'Peer persistence not available';
  }

  const candidates = await mesh.peerPersistence.getReconnectionCandidates({
    limit: 20,
    maxAge: 7 * 24 * 60 * 60 * 1000 // Last 7 days
  });

  if (candidates.length === 0) {
    return 'No saved peers found';
  }

  const output = [`Saved Peers (${candidates.length}):`];
  for (const candidate of candidates.slice(0, 10)) {
    const peer = candidate.peer;
    const lastSeen = new Date(peer.lastSeen).toLocaleString();
    const status = mesh.peers.has(peer.peerId) ? 'Connected' : 'Disconnected';
    output.push(`${status} ${peer.displayName} (score: ${candidate.score})`);
    output.push(`   Last seen: ${lastSeen}`);
  }
  return output.join('\n');
}

window.showSavedPeers = showSavedPeers;

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

// Welcome message only for new identities
if (identity.isNew) {
  addMessage('Welcome! Your identity has been created.', 'system');
}

// Initialize markdown input component
try {
  markdownInput = new MarkdownInput('messageInput', {
    debounceDelay: 300
  });
} catch (error) {
  console.error('[App] Failed to initialize markdown input:', error);
}

// Start automatic reconnection
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeReconnection);
} else {
  // DOM already loaded, call immediately
  initializeReconnection();
}
