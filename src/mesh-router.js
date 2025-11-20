// Message Router with Flood Routing and Deduplication

class MessageRouter {
  constructor(identity, config = {}) {
    this.identity = identity;
    this.peerManager = null; // Set by mesh.js

    // Configuration
    this.config = {
      defaultTTL: config.defaultTTL || 7,
      maxHops: config.maxHops || 10,
      seenMessageExpiry: config.seenMessageExpiry || 60000, // 1 minute
      cleanupInterval: config.cleanupInterval || 30000,     // 30 seconds
      maxSeenMessages: config.maxSeenMessages || 10000
    };

    // Deduplication
    this.seenMessages = new Map(); // msgId -> { timestamp, from, hops }

    // Message handlers
    this.messageHandlers = new Map();

    // Statistics
    this.stats = {
      messagesReceived: 0,
      messagesForwarded: 0,
      messagesDuplicate: 0,
      messagesExpired: 0,
      messagesDelivered: 0
    };

    // Start cleanup timer
    this.startCleanup();
  }

  setPeerManager(peerManager) {
    this.peerManager = peerManager;
  }

  // Register message handler
  on(msgType, handler) {
    this.messageHandlers.set(msgType, handler);
  }

  // Generate unique message ID
  generateId() {
    return `${this.identity.uuid}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Create message envelope
  createMessage(msgType, payload, options = {}) {
    return {
      msgId: this.generateId(),
      msgType,
      senderId: this.identity.uuid,
      senderName: this.identity.displayName,
      timestamp: Date.now(),
      ttl: options.ttl || this.config.defaultTTL,
      hopCount: 0,
      path: [this.identity.uuid],
      targetPeerId: options.targetPeerId || null,
      routingHint: options.routingHint || 'broadcast',
      payload
    };
  }

  // Main routing function
  async routeMessage(message, fromPeerId = null) {
    this.stats.messagesReceived++;

    // Validate message structure
    if (!this.validateMessage(message)) {
      console.warn('[Router] Invalid message structure:', message);
      return false;
    }

    // Check for duplicates
    if (this.isDuplicate(message.msgId, fromPeerId)) {
      this.stats.messagesDuplicate++;
      return false;
    }

    // Record as seen
    this.recordSeen(message.msgId, fromPeerId, message.hopCount);

    // Check TTL
    if (message.ttl <= 0) {
      this.stats.messagesExpired++;
      return false;
    }

    // Check hop count
    if (message.hopCount >= this.config.maxHops) {
      this.stats.messagesExpired++;
      return false;
    }

    // Check for loops
    if (this.hasLoop(message.path)) {
      console.warn('[Router] Loop detected in path:', message.path);
      return false;
    }

    // Is this message for us?
    const isForUs = this.isMessageForUs(message);

    if (isForUs) {
      this.stats.messagesDelivered++;
      await this.deliverMessage(message);
    }

    // Should we forward this message?
    if (this.shouldForward(message, isForUs, fromPeerId)) {
      await this.forwardMessage(message, fromPeerId);
    }

    return true;
  }

  validateMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if (!message.msgId || !message.msgType || !message.senderId) return false;
    if (typeof message.ttl !== 'number' || message.ttl < 0) return false;
    if (typeof message.hopCount !== 'number' || message.hopCount < 0) return false;
    if (!Array.isArray(message.path) || message.path.length === 0) return false;
    return true;
  }

  isDuplicate(msgId, fromPeerId) {
    if (!this.seenMessages.has(msgId)) {
      return false;
    }

    const seen = this.seenMessages.get(msgId);

    // If seen from same peer very recently, definitely duplicate
    if (seen.from === fromPeerId && Date.now() - seen.timestamp < 5000) {
      return true;
    }

    // If seen from any peer very recently, likely duplicate
    if (Date.now() - seen.timestamp < 1000) {
      return true;
    }

    return false;
  }

  recordSeen(msgId, fromPeerId, hopCount) {
    this.seenMessages.set(msgId, {
      timestamp: Date.now(),
      from: fromPeerId,
      hops: hopCount
    });

    // Prevent unbounded growth
    if (this.seenMessages.size > this.config.maxSeenMessages) {
      this.pruneOldestSeenMessages(1000);
    }
  }

  hasLoop(path) {
    const uniquePath = new Set(path);
    return uniquePath.size !== path.length;
  }

  isMessageForUs(message) {
    // Explicitly targeted at us
    if (message.targetPeerId === this.identity.uuid) {
      return true;
    }

    // Broadcast messages are for everyone
    if (!message.targetPeerId && message.routingHint === 'broadcast') {
      return true;
    }

    // Chat messages are for everyone
    if (message.msgType === 'chat') {
      return true;
    }

    return false;
  }

  shouldForward(message, wasDelivered, fromPeerId) {
    // Never forward if TTL exhausted
    if (message.ttl <= 1) return false;

    // Targeted messages
    if (message.targetPeerId) {
      // Only forward if not yet delivered to target
      return message.targetPeerId !== this.identity.uuid;
    }

    // Broadcast messages - always forward (flood routing)
    // Note: Safety handled by deduplication, loop prevention, and excludePeerId in forwardMessage
    return true;
  }

  async forwardMessage(message, excludePeerId) {
    if (!this.peerManager) {
      console.warn('[Router] No peer manager set');
      return 0;
    }

    this.stats.messagesForwarded++;

    // Decrement TTL and increment hop count
    const forwardedMessage = {
      ...message,
      ttl: message.ttl - 1,
      hopCount: message.hopCount + 1,
      path: [...message.path, this.identity.uuid]
    };

    // Get all connected peers
    const peers = Array.from(this.peerManager.peers.entries());

    let forwardCount = 0;
    for (const [peerId, peerData] of peers) {
      // Skip if not connected
      if (peerData.status !== 'connected') continue;

      // Skip the peer we received from
      if (peerId === excludePeerId) continue;

      // Skip if already in path (loop prevention)
      if (message.path.includes(peerId)) continue;

      // Skip if this is the sender
      if (peerId === message.senderId) continue;

      // Skip temporary peers
      if (peerId === '_temp') continue;

      // Forward the message
      try {
        peerData.peer.send(JSON.stringify(forwardedMessage));
        forwardCount++;
      } catch (e) {
        console.error(`[Router] Failed to forward to ${peerId}:`, e);
      }
    }

    if (forwardCount > 0) {
      console.log(`[Router] Forwarded message ${message.msgId} to ${forwardCount} peers`);
    }

    return forwardCount;
  }

  async deliverMessage(message) {
    const handler = this.messageHandlers.get(message.msgType);

    if (handler) {
      try {
        await handler(message);
      } catch (e) {
        console.error(`[Router] Handler error for ${message.msgType}:`, e);
      }
    } else {
      console.warn(`[Router] No handler for message type: ${message.msgType}`);
    }
  }

  // Cleanup old seen messages
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupSeenMessages();
    }, this.config.cleanupInterval);
  }

  cleanupSeenMessages() {
    const now = Date.now();
    const expiry = this.config.seenMessageExpiry;
    let cleaned = 0;

    for (const [msgId, data] of this.seenMessages.entries()) {
      if (now - data.timestamp > expiry) {
        this.seenMessages.delete(msgId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[Router] Cleaned ${cleaned} old messages from cache`);
    }
  }

  pruneOldestSeenMessages(count) {
    const sorted = Array.from(this.seenMessages.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    for (let i = 0; i < count && i < sorted.length; i++) {
      this.seenMessages.delete(sorted[i][0]);
    }
  }

  getStats() {
    return {
      ...this.stats,
      seenMessagesCount: this.seenMessages.size
    };
  }

  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

export default MessageRouter;
