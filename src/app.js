/**
 * Simple P2P Chat App
 */
import './styles/main.css';
import p2p from './p2p.js';

const $ = (id) => document.getElementById(id);

// App State
let isInitiator = false;

// Setup P2P callbacks
p2p.onConnect(() => {
  showChat();
  addMessage('✅ Connected!', 'system');
});

p2p.onMessage((message) => {
  addMessage(message, 'peer');
});

p2p.onDisconnect(() => {
  addMessage('❌ Disconnected', 'system');
});

// UI Functions
function showSetup() {
  $('setup').classList.remove('hidden');
  $('chat').classList.add('hidden');
  $('initiatorFlow').classList.add('hidden');
  $('joinerFlow').classList.add('hidden');
}

function showChat() {
  $('setup').classList.add('hidden');
  $('chat').classList.remove('hidden');
}

function addMessage(text, type) {
  const div = document.createElement('div');
  div.className = `message ${type}`;

  if (type === 'sent') {
    div.textContent = `You: ${text}`;
  } else if (type === 'peer') {
    div.textContent = `Peer: ${text}`;
  } else {
    div.textContent = text;
  }

  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
}

// Event Handlers
$('btnInvite').onclick = async () => {
  isInitiator = true;
  $('btnInvite').disabled = true;
  $('btnJoin').disabled = true;
  $('initiatorFlow').classList.remove('hidden');

  const offer = await p2p.createOffer();
  $('offerOutput').value = offer;
  addMessage('Offer generated. Share it with your peer.', 'system');
};

$('btnJoin').onclick = () => {
  isInitiator = false;
  $('btnInvite').disabled = true;
  $('btnJoin').disabled = true;
  $('joinerFlow').classList.remove('hidden');
};

$('btnCopyOffer').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('offerOutput').value);
    $('btnCopyOffer').textContent = '✅ Copied!';
    setTimeout(() => ($('btnCopyOffer').textContent = '📋 Copy'), 2000);
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
    const answer = await p2p.acceptOffer(offer);
    $('answerOutput').value = answer;
    $('joinerAnswerStep').classList.remove('hidden');
    addMessage('Answer generated. Share it with your peer.', 'system');
  } catch (e) {
    alert('Invalid offer format');
  }
};

$('btnCopyAnswer').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('answerOutput').value);
    $('btnCopyAnswer').textContent = '✅ Copied!';
    setTimeout(() => ($('btnCopyAnswer').textContent = '📋 Copy'), 2000);
  } catch (e) {
    $('answerOutput').select();
    alert('Please copy manually (Ctrl+C)');
  }
};

$('btnAcceptAnswer').onclick = () => {
  const answer = $('answerInput').value.trim();
  if (!answer) {
    alert('Please paste an answer');
    return;
  }

  try {
    p2p.acceptAnswer(answer);
    addMessage('Connecting...', 'system');
  } catch (e) {
    alert('Invalid answer format');
  }
};

$('btnSend').onclick = () => {
  const text = $('messageInput').value.trim();
  if (text && p2p.connected) {
    p2p.send(text);
    addMessage(text, 'sent');
    $('messageInput').value = '';
  }
};

$('messageInput').onkeypress = (e) => {
  if (e.key === 'Enter') {
    $('btnSend').click();
  }
};

// Initialize
console.log('Simple P2P Chat initialized');
