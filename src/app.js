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
// Connection Diagnostics Panel
// ============================================

function showDiagnostics() {
  // Dynamically import diagnostics module
  import('./diagnostics/connection-diagnostics.js').then((module) => {
    const diagnostics = module.default;
    const globalStats = diagnostics.getGlobalStats();
    const summary = diagnostics.getSummary();

    // Build connection type rows
    let connectionTypeRows = '';
    if (globalStats.connectionsByType && globalStats.connectionsByType.length > 0) {
      const maxCount = Math.max(...globalStats.connectionsByType.map((c) => c.count));
      connectionTypeRows = globalStats.connectionsByType
        .map(
          ({ type, count }) => `
          <div class="connection-type-row">
            <span class="type-name">${type}</span>
            <span class="type-count">${count}</span>
            <div class="type-bar" style="width: ${(count / maxCount) * 100}%"></div>
          </div>
        `
        )
        .join('');
    } else {
      connectionTypeRows = '<div class="no-data">No connection data yet</div>';
    }

    // Build current connections list
    let currentConnectionsHTML = '';
    const connectedPeers = Array.from(mesh.peers.entries()).filter(
      ([id, data]) => data.status === 'connected' && id !== '_temp'
    );

    if (connectedPeers.length > 0) {
      currentConnectionsHTML = connectedPeers
        .map(([id, data]) => {
          const diag = diagnostics.getDiagnostics(id);
          return `
            <div class="connection-detail">
              <div class="connection-name">${data.displayName}</div>
              <div class="connection-info">
                <span><i class="ti ti-plug"></i> ${diag?.connectionType?.name || 'Unknown'}</span>
                <span><i class="ti ti-network"></i> ${diag?.protocol || 'Unknown'}</span>
                ${
                  diag?.timing.connectionTime
                    ? `<span><i class="ti ti-clock"></i> ${diag.timing.connectionTime}ms</span>`
                    : ''
                }
                ${
                  diag?.rtt
                    ? `<span><i class="ti ti-activity"></i> RTT: ${(diag.rtt * 1000).toFixed(1)}ms</span>`
                    : ''
                }
              </div>
            </div>
          `;
        })
        .join('');
    } else {
      currentConnectionsHTML = '<div class="no-data">No active connections</div>';
    }

    // Create modal HTML
    const diagHTML = `
      <div class="diagnostics-modal" id="diagnosticsModal">
        <div class="diagnostics-overlay"></div>
        <div class="diagnostics-content">
          <div class="diagnostics-header">
            <h2><i class="ti ti-activity"></i> Connection Diagnostics</h2>
            <button class="btn-close-diagnostics" id="btnCloseDiagnostics">
              <i class="ti ti-x"></i>
            </button>
          </div>

          <div class="diagnostics-body">
            <!-- Global Statistics -->
            <div class="diag-section">
              <h3>Global Statistics</h3>
              <div class="diag-grid">
                <div class="diag-stat">
                  <span class="diag-label">Total Attempts:</span>
                  <span class="diag-value">${globalStats.totalAttempts}</span>
                </div>
                <div class="diag-stat">
                  <span class="diag-label">Successful:</span>
                  <span class="diag-value success">${globalStats.successfulConnections}</span>
                </div>
                <div class="diag-stat">
                  <span class="diag-label">Failed:</span>
                  <span class="diag-value error">${globalStats.failedConnections}</span>
                </div>
                <div class="diag-stat">
                  <span class="diag-label">Success Rate:</span>
                  <span class="diag-value">${globalStats.successRate}%</span>
                </div>
                <div class="diag-stat">
                  <span class="diag-label">Avg Connection Time:</span>
                  <span class="diag-value">${Math.round(globalStats.avgConnectionTime)}ms</span>
                </div>
                <div class="diag-stat">
                  <span class="diag-label">Avg ICE Gathering:</span>
                  <span class="diag-value">${Math.round(globalStats.avgGatheringTime)}ms</span>
                </div>
              </div>
            </div>

            <!-- Connection Types -->
            <div class="diag-section">
              <h3>Connections by Type</h3>
              <div class="connection-types">
                ${connectionTypeRows}
              </div>
            </div>

            <!-- Current Connections -->
            <div class="diag-section">
              <h3>Current Connections (${connectedPeers.length})</h3>
              <div class="current-connections">
                ${currentConnectionsHTML}
              </div>
            </div>

            <!-- ICE Candidate Statistics -->
            <div class="diag-section">
              <h3>ICE Candidate Statistics</h3>
              <div class="diag-grid">
                <div class="diag-stat">
                  <span class="diag-label">Avg Host Candidates:</span>
                  <span class="diag-value">${summary.candidateStats.avgHostCandidates}</span>
                </div>
                <div class="diag-stat">
                  <span class="diag-label">Avg STUN Candidates:</span>
                  <span class="diag-value">${summary.candidateStats.avgSrflxCandidates}</span>
                </div>
                <div class="diag-stat">
                  <span class="diag-label">Avg TURN Candidates:</span>
                  <span class="diag-value">${summary.candidateStats.avgRelayCandidates}</span>
                </div>
                <div class="diag-stat">
                  <span class="diag-label">Total Avg Candidates:</span>
                  <span class="diag-value">${summary.candidateStats.totalCandidates}</span>
                </div>
              </div>
            </div>

            <!-- Export Button -->
            <div class="diag-section">
              <button class="btn-export-diagnostics" id="btnExportDiagnostics">
                <i class="ti ti-download"></i>
                <span>Export Diagnostics JSON</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Add to DOM
    const existingModal = document.getElementById('diagnosticsModal');
    if (existingModal) {
      existingModal.remove();
    }

    document.body.insertAdjacentHTML('beforeend', diagHTML);

    // Set up event listeners
    $('btnCloseDiagnostics').onclick = closeDiagnostics;
    $('diagnosticsModal').querySelector('.diagnostics-overlay').onclick = closeDiagnostics;
    $('btnExportDiagnostics').onclick = exportDiagnostics;

    // Close on ESC key
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        closeDiagnostics();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);
  });
}

function closeDiagnostics() {
  const modal = document.getElementById('diagnosticsModal');
  if (modal) {
    modal.remove();
  }
}

function exportDiagnostics() {
  import('./diagnostics/connection-diagnostics.js').then((module) => {
    const diagnostics = module.default;
    const data = diagnostics.exportDiagnostics();

    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `connection-diagnostics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    // Show feedback
    const exportBtn = $('btnExportDiagnostics');
    const originalHTML = exportBtn.innerHTML;
    exportBtn.innerHTML = '<i class="ti ti-check"></i><span>Exported!</span>';
    setTimeout(() => {
      exportBtn.innerHTML = originalHTML;
    }, 2000);
  });
}

// Diagnostics button click handler
$('btnDiagnostics').onclick = () => {
  showDiagnostics();
};

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
// Automatic Reconnection
// ============================================

async function initializeReconnection() {
  console.log('[App] Initializing automatic reconnection...');

  try {
    // Check if reconnection is enabled
    if (!mesh.reconnectionEnabled) {
      console.warn('[App] Reconnection system not available');
      return;
    }

    // Small delay to let network stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Attempt reconnection
    const result = await mesh.reconnectToMesh();

    if (result.method === 'fallback_required') {
      // All automatic reconnection failed, show manual pairing UI
      console.log('[App] Automatic reconnection failed, showing pairing UI');
      addMessage('No saved connections found. Click "New Connection" to connect.', 'system');
    } else if (result.peersConnected > 0) {
      // Successfully reconnected
      console.log(`[App] Reconnected to ${result.peersConnected} peer(s)`);
      addMessage(`Reconnected to ${result.peersConnected} peer(s) automatically!`, 'system');

      // Enable UI
      $('messageInput').disabled = false;
      $('btnSend').disabled = false;
    } else {
      // No peers to reconnect to
      console.log('[App] No peers available for reconnection');
      addMessage('No saved connections. Click "New Connection" to connect.', 'system');
    }
  } catch (error) {
    console.error('[App] Reconnection failed:', error);
    addMessage('Reconnection error. Click "New Connection" to connect manually.', 'system');
  }
}

// Debug utilities
window.showReconnectionStats = () => {
  const stats = mesh.getReconnectionStats();
  if (!stats) {
    console.log('Reconnection system not enabled');
    return;
  }

  console.log('='.repeat(50));
  console.log('RECONNECTION SYSTEM STATISTICS');
  console.log('='.repeat(50));

  if (stats.master) {
    console.log('\n📊 Master Strategy:');
    console.log('  Total attempts:', stats.master.totalReconnectionAttempts);
    console.log('  Successful:', stats.master.successfulReconnections);
    console.log('  Failed:', stats.master.failedReconnections);
    console.log('  Success rate:',
      stats.master.totalReconnectionAttempts > 0
        ? `${((stats.master.successfulReconnections / stats.master.totalReconnectionAttempts) * 100).toFixed(1)}%`
        : 'N/A'
    );
  }

  if (stats.persistence) {
    console.log('\n💾 Persistence:');
    console.log('  Total saved peers:', stats.persistence.totalPeers);
    console.log('  Needs cleanup:', stats.persistence.needsCleanup);
  }

  if (stats.network) {
    console.log('\n🌐 Network:');
    console.log('  IP changes:', stats.network.ipChangeCount);
    console.log('  Connection type:', stats.network.currentConnectionType);
    console.log('  Online:', stats.network.isOnline);
  }

  console.log('\n' + '='.repeat(50));
};

async function showSavedPeers() {
  if (!mesh.peerPersistence) {
    console.log('Peer persistence not available');
    return;
  }

  const candidates = await mesh.peerPersistence.getReconnectionCandidates({
    limit: 20,
    maxAge: 7 * 24 * 60 * 60 * 1000 // Last 7 days
  });

  if (candidates.length === 0) {
    console.log('No saved peers found');
    return;
  }

  console.log(`📋 Saved Peers (${candidates.length}):`);
  for (const candidate of candidates.slice(0, 10)) {
    const peer = candidate.peer;
    const lastSeen = new Date(peer.lastSeen).toLocaleString();
    const status = mesh.peers.has(peer.peerId) ? '🟢 Connected' : '⚪ Disconnected';
    console.log(`${status} ${peer.displayName} (score: ${candidate.score})`);
    console.log(`   Last seen: ${lastSeen}`);
  }
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

// Welcome message
addMessage('Welcome! Your identity has been created.', 'system');

// Start automatic reconnection
window.addEventListener('DOMContentLoaded', () => {
  initializeReconnection();
});
