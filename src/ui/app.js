/**
 * Main UI application logic
 */
import identity from '../core/identity.js';
import peerManager from '../core/peer.js';
import dht from '../core/dht.js';
import messageHandler from '../core/messages.js';
import { $, show, hide, setText, setHTML, getValue, clearValue, addClass, removeClass } from './dom.js';

class App {
  constructor() {
    this.currentVerifyPeer = null;
  }

  async initialize() {
    // Initialize identity
    await identity.initialize();

    // Set up event handlers
    this.setupEventHandlers();

    // Set up message callbacks
    this.setupMessageHandlers();

    // Update UI
    this.updateIdentityUI();
    this.updateTokenStatusUI();

    this.addMessage(`Your ID: ${identity.peerId}`);

    // Start token refresh timer
    this.startTokenRefreshTimer();

    // Check for saved passphrase
    const savedPassphrase = dht.getSavedPassphrase();
    if (savedPassphrase) {
      this.addMessage(`Previous swarm: "${savedPassphrase}"`);
      this.addMessage('Click "Join Swarm" to reconnect');
      setValue('swarmPassphrase', savedPassphrase);
    } else {
      this.addMessage('Click "Join Swarm" to get started');
    }
  }

  setupEventHandlers() {
    // Join swarm
    $('btnJoinSwarm').onclick = () => this.showJoinModal();
    $('btnStartSwarm').onclick = () => this.joinSwarm();
    $('btnCancelJoin').onclick = () => this.hideJoinModal();
    $('btnLeaveSwarm').onclick = () => this.leaveSwarm();

    // Clear storage
    $('btnClearStorage').onclick = () => this.clearStorage();

    // Chat
    $('btnSend').onclick = () => this.sendChat();
    $('messageInput').onkeypress = e => {
      if (e.key === 'Enter') this.sendChat();
    };

    // Verification chat
    $('btnSendVerification').onclick = () => this.sendVerification();
    $('verificationInput').onkeypress = e => {
      if (e.key === 'Enter') this.sendVerification();
    };

    // Verify modal
    $('btnVerifyModalSend').onclick = () => this.sendVerificationModal();
    $('verifyModalInput').onkeypress = e => {
      if (e.key === 'Enter') this.sendVerificationModal();
    };
    $('btnGrantAccess').onclick = () => this.grantFullAccess();
    $('btnRejectPeer').onclick = () => this.rejectCurrentPeer();
    $('btnCloseVerify').onclick = () => this.closeVerifyModal();

    // Tab switching
    window.switchTab = tab => this.switchTab(tab);
    window.startVerification = peerId => this.startVerification(peerId);
    window.rejectPeer = peerId => this.rejectPeer(peerId);
    window.openVerifyModal = peerId => this.openVerifyModal(peerId);
  }

  setupMessageHandlers() {
    // Peer message handler
    peerManager.onMessage((peerId, message) => {
      messageHandler.handlePeerMessage(peerId, message);
    });

    // Peer connection handler
    peerManager.onConnection(peerId => {
      const isProbation = identity.approvedPeers[peerId]?.status === 'probation';
      this.addMessage(`${peerId} connected${isProbation ? ' (probation)' : ''}`);
      this.updatePeerList();

      // Share peer list
      const otherPeers = Array.from(peerManager.peers.keys()).filter(id => id !== peerId);
      if (otherPeers.length > 0) {
        peerManager.sendToPeer(peerId, { type: 'peer-list', peers: otherPeers });
      }

      // Check if we need token refresh
      const status = identity.getTokenStatus();
      if (status && status.needsRefresh && peerManager.getPeerCount() > 0) {
        this.refreshTokens();
      }
    });

    // Peer disconnection handler
    peerManager.onDisconnection(peerId => {
      this.addMessage(`${peerId} disconnected`);
      this.updatePeerList();
    });

    // DHT wire handler
    dht.onWire((wire, torrent) => {
      this.updateDHTStatus(torrent);

      setTimeout(() => {
        dht.sendViaWire(wire, {
          type: 'announce',
          peerId: identity.peerId,
          publicKey: identity.keys.publicKey,
          accessToken: identity.accessToken,
          refreshToken: identity.refreshToken,
        });
      }, 500);
    });

    // DHT message handler
    dht.onMessage((wire, message) => {
      messageHandler.handleWireMessage(wire, message);
    });

    // Message callbacks
    messageHandler.onChatMessage((text, sender) => {
      this.addMessage(text, sender);
    });

    messageHandler.onVerificationMessage((text, sender) => {
      this.addMessage(text, sender, 'verification');
      addClass('tabVerification', 'notification');
    });

    messageHandler.onSystemMessage((text, type = 'main') => {
      this.addMessage(text, null, type);
    });

    messageHandler.onPeerStatusChange(() => {
      this.updatePendingList();
    });
  }

  updateIdentityUI() {
    setText('myId', identity.peerId);
  }

  updateTokenStatusUI() {
    const statusEl = $('tokenStatus');
    const status = identity.getTokenStatus();

    if (!status) {
      setText(statusEl, 'No token');
      statusEl.className = 'token-status expired';
      return;
    }

    if (status.expired) {
      setText(statusEl, '🔑 Token expired - needs refresh');
      statusEl.className = 'token-status expired';
    } else if (status.needsRefresh) {
      setText(statusEl, `🔑 Token expires in ${status.hours}h ${status.minutes}m`);
      statusEl.className = 'token-status expiring';
    } else {
      setText(statusEl, `🔑 Token valid (${status.hours}h ${status.minutes}m)`);
      statusEl.className = 'token-status valid';
    }
  }

  updatePeerList() {
    const list = $('peerList');
    const count = peerManager.getPeerCount();
    setText('peerCount', count);

    if (count === 0) {
      setHTML(
        list,
        '<div style="color: #666; text-align: center; padding: 20px;">No peers connected yet</div>'
      );
      return;
    }

    let html = '';
    peerManager.getAllPeers().forEach(([peerId, data]) => {
      const peerApproval = identity.approvedPeers[peerId];
      const isProbation = peerApproval?.status === 'probation';
      const latencyClass = data.latency < 50 ? 'good' : data.latency < 150 ? 'medium' : 'bad';
      const latencyText = data.latency ? `${data.latency}ms` : '...';
      const connType = data.connectionType || '...';
      const connIcon = connType === 'relay' ? '📡' : connType.includes('udp') ? '⚡' : '🔗';

      let actions = '';
      if (isProbation) {
        actions = `<button class="warning small" onclick="openVerifyModal('${peerId}')">Verify</button>`;
      }

      html += `
        <div class="peer-card">
          <div class="peer-header">
            <div style="display: flex; align-items: center;">
              <div class="peer-status ${isProbation ? 'probation' : data.status}"></div>
              <div class="peer-info">
                <div class="peer-name ${isProbation ? 'probation' : ''}">${peerId} ${isProbation ? '(probation)' : ''}</div>
                <div class="peer-meta ${latencyClass}">${connIcon} ${connType} · ${latencyText}</div>
              </div>
            </div>
            <div>${actions}</div>
          </div>
        </div>
      `;
    });

    setHTML(list, html);
  }

  updatePendingList() {
    const panel = $('pendingPanel');
    const list = $('pendingList');
    const pending = messageHandler.getPendingVerifications();

    if (pending.length === 0) {
      hide(panel);
      return;
    }

    show(panel);

    let html = '';
    pending.forEach(([peerId, data]) => {
      html += `
        <div class="pending-card">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div class="peer-name" style="color: #2196f3;">${peerId}</div>
              <div style="font-size: 11px; color: #888;">Wants to join - needs verification</div>
            </div>
            <div>
              <button class="secondary small" onclick="startVerification('${peerId}')">Begin Verification</button>
              <button class="danger small" onclick="rejectPeer('${peerId}')">Reject</button>
            </div>
          </div>
        </div>
      `;
    });

    setHTML(list, html);
  }

  updateDHTStatus(torrent) {
    const peerCount = torrent ? torrent.numPeers : 0;
    setText('dhtStatus', dht.isActive() ? `In swarm (${peerCount} peers)` : '');
  }

  addMessage(text, sender = null, type = 'main') {
    const container = type === 'verification' ? $('verificationMessages') : $('messages');
    const div = document.createElement('div');
    div.className = 'message' + (sender ? '' : ' system');

    if (sender) {
      const senderSpan = document.createElement('span');
      senderSpan.className = 'sender';
      senderSpan.style.color = sender === identity.peerId ? '#4fc3f7' : '#81c784';
      senderSpan.textContent = sender === identity.peerId ? 'You' : sender;
      div.appendChild(senderSpan);
      div.appendChild(document.createTextNode(': ' + text));
    } else {
      div.textContent = text;
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    // Update verify modal if open
    if (this.currentVerifyPeer && type === 'verification') {
      const modalContainer = $('verifyModalMessages');
      const clone = div.cloneNode(true);
      modalContainer.appendChild(clone);
      modalContainer.scrollTop = modalContainer.scrollHeight;
    }
  }

  switchTab(tab) {
    $('tabMain').className = tab === 'main' ? 'tab active' : 'tab';
    $('tabVerification').className = tab === 'verification' ? 'tab active' : 'tab';
    $('mainChat').className = tab === 'main' ? '' : 'hidden';
    $('verificationChat').className = tab === 'verification' ? '' : 'hidden';

    if (tab === 'verification') {
      removeClass('tabVerification', 'notification');
    }
  }

  showJoinModal() {
    show('joinModal');
  }

  hideJoinModal() {
    hide('joinModal');
  }

  async joinSwarm() {
    const passphrase = getValue('swarmPassphrase').trim();
    if (!passphrase) {
      alert('Enter a passphrase');
      return;
    }

    setText('dhtStatus', 'Joining swarm...');

    try {
      const torrent = await dht.join(passphrase);
      dht.savePassphrase();
      this.hideJoinModal();
      this.addMessage('Joined swarm');
      show('btnLeaveSwarm');
      $('btnJoinSwarm').disabled = true;

      // Update DHT status periodically
      const updateInterval = setInterval(() => {
        if (dht.isActive()) {
          this.updateDHTStatus(torrent);
        } else {
          clearInterval(updateInterval);
        }
      }, 3000);
    } catch (error) {
      this.addMessage(`Failed to join swarm: ${error.message}`);
      setText('dhtStatus', '');
      this.hideJoinModal();
    }
  }

  leaveSwarm() {
    dht.leave();
    dht.clearPassphrase();
    this.addMessage('Left swarm');
    setText('dhtStatus', '');
    hide('btnLeaveSwarm');
    $('btnJoinSwarm').disabled = false;
  }

  clearStorage() {
    if (confirm('Clear all data?')) {
      localStorage.clear();
      location.reload();
    }
  }

  sendChat() {
    const text = getValue('messageInput').trim();
    if (!text) return;

    peerManager.broadcast({ type: 'chat', sender: identity.peerId, text });
    this.addMessage(text, identity.peerId);
    clearValue('messageInput');
  }

  sendVerification() {
    const text = getValue('verificationInput').trim();
    if (!text) return;

    peerManager.broadcast({ type: 'verification-chat', sender: identity.peerId, text });
    this.addMessage(text, identity.peerId, 'verification');
    clearValue('verificationInput');
  }

  sendVerificationModal() {
    const text = getValue('verifyModalInput').trim();
    if (!text) return;

    peerManager.broadcast({ type: 'verification-chat', sender: identity.peerId, text });
    this.addMessage(text, identity.peerId, 'verification');
    clearValue('verifyModalInput');
  }

  startVerification(peerId) {
    if (messageHandler.grantProbation(peerId)) {
      this.updatePendingList();
      this.switchTab('verification');
    }
  }

  rejectPeer(peerId) {
    messageHandler.rejectPeer(peerId);
    this.updatePendingList();
    this.updatePeerList();
  }

  openVerifyModal(peerId) {
    if (!peerId || !peerManager.peers.has(peerId)) return;

    this.currentVerifyPeer = peerId;
    setText('verifyPeerId', peerId);
    setHTML('verifyModalMessages', $('verificationMessages').innerHTML);
    show('verifyModal');
  }

  closeVerifyModal() {
    hide('verifyModal');
    this.currentVerifyPeer = null;
  }

  grantFullAccess() {
    if (!this.currentVerifyPeer) return;

    messageHandler.grantFullAccess(this.currentVerifyPeer);
    this.closeVerifyModal();
    this.updatePeerList();
  }

  rejectCurrentPeer() {
    if (this.currentVerifyPeer) {
      this.rejectPeer(this.currentVerifyPeer);
      this.closeVerifyModal();
    }
  }

  async refreshTokens() {
    await identity.refreshTokens();
    peerManager.broadcast({
      type: 'token-update',
      peerId: identity.peerId,
      accessToken: identity.accessToken,
      refreshToken: identity.refreshToken,
    });
    this.updateTokenStatusUI();
    this.addMessage('Tokens refreshed', null, 'system');
  }

  startTokenRefreshTimer() {
    setInterval(async () => {
      const status = identity.getTokenStatus();
      if (status && status.needsRefresh && peerManager.getPeerCount() > 0) {
        await this.refreshTokens();
      }
      this.updateTokenStatusUI();
    }, 60000);
  }
}

export default new App();
