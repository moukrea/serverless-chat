// Security and Attack Prevention

class SecurityManager {
  constructor() {
    // Track malicious behavior
    this.peerViolations = new Map(); // peerId -> violation count
    this.messageRateLimits = new Map(); // peerId -> { count, windowStart }

    // Thresholds
    this.MAX_VIOLATIONS = 3;
    this.RATE_LIMIT_WINDOW = 1000; // 1 second
    this.RATE_LIMIT_MAX = 50; // 50 messages per second
    this.MAX_MESSAGE_SIZE = 100000; // 100KB
    this.MAX_PATH_LENGTH = 20;

    // Ban list
    this.loadBanList();
  }

  // Rate limiting
  checkRateLimit(peerId) {
    const now = Date.now();
    const limit = this.messageRateLimits.get(peerId);

    if (!limit || now - limit.windowStart > this.RATE_LIMIT_WINDOW) {
      // Start new window
      this.messageRateLimits.set(peerId, {
        count: 1,
        windowStart: now
      });
      return true;
    }

    limit.count++;

    if (limit.count > this.RATE_LIMIT_MAX) {
      this.recordViolation(peerId, 'rate_limit_exceeded');
      return false;
    }

    return true;
  }

  // Message validation
  validateMessageStructure(message) {
    try {
      // Check for overly large messages
      const serialized = JSON.stringify(message);
      if (serialized.length > this.MAX_MESSAGE_SIZE) {
        console.warn('[Security] Message exceeds size limit');
        return false;
      }

      // Check for excessively long paths
      if (message.path && message.path.length > this.MAX_PATH_LENGTH) {
        console.warn('[Security] Path exceeds maximum length');
        return false;
      }

      // Check for invalid TTL
      if (message.ttl > 10 || message.ttl < 0) {
        console.warn('[Security] Invalid TTL value');
        return false;
      }

      // Check for invalid hop count
      if (message.hopCount > 20 || message.hopCount < 0) {
        console.warn('[Security] Invalid hop count');
        return false;
      }

      return true;
    } catch (e) {
      console.error('[Security] Error validating message:', e);
      return false;
    }
  }

  // TTL consistency check
  validateTTLConsistency(message, previousTTL) {
    if (previousTTL && message.ttl >= previousTTL) {
      console.warn('[Security] TTL increased in transit - possible attack');
      return false;
    }
    return true;
  }

  // Path validation
  validatePath(message, fromPeerId) {
    if (!message.path || message.path.length === 0) {
      console.warn('[Security] Empty path');
      return false;
    }

    // Last peer in path should be related to sender
    const lastInPath = message.path[message.path.length - 1];

    // Either last in path is the sender, or we're receiving from an intermediate peer
    if (lastInPath !== fromPeerId && lastInPath !== message.senderId) {
      // This might be okay for multi-hop, so just log
      console.log('[Security] Path mismatch (might be multi-hop)');
    }

    return true;
  }

  // Sanitize user input
  sanitizeMessage(text) {
    if (typeof text !== 'string') return '';

    return text
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .substring(0, 5000); // Max 5000 chars
  }

  // Violation tracking
  recordViolation(peerId, reason) {
    const violations = this.peerViolations.get(peerId) || 0;
    this.peerViolations.set(peerId, violations + 1);

    console.warn(`[Security] Violation recorded for ${peerId.substring(0, 8)}: ${reason} (total: ${violations + 1})`);

    if (violations + 1 >= this.MAX_VIOLATIONS) {
      this.banPeer(peerId);
    }
  }

  // Ban management
  banPeer(peerId) {
    console.error(`[Security] Banning peer ${peerId.substring(0, 8)} for excessive violations`);

    // Add to ban list
    const banList = this.getBanList();
    if (!banList.includes(peerId)) {
      banList.push(peerId);
      localStorage.setItem('meshBanList', JSON.stringify(banList));
    }
  }

  isBanned(peerId) {
    const banList = this.getBanList();
    return banList.includes(peerId);
  }

  getBanList() {
    try {
      return JSON.parse(localStorage.getItem('meshBanList') || '[]');
    } catch (e) {
      return [];
    }
  }

  loadBanList() {
    const banList = this.getBanList();
    console.log(`[Security] Loaded ${banList.length} banned peers`);
  }

  unbanPeer(peerId) {
    const banList = this.getBanList();
    const filtered = banList.filter(id => id !== peerId);
    localStorage.setItem('meshBanList', JSON.stringify(filtered));
    console.log(`[Security] Unbanned peer ${peerId.substring(0, 8)}`);
  }

  clearBanList() {
    localStorage.setItem('meshBanList', JSON.stringify([]));
    console.log('[Security] Cleared ban list');
  }

  getStats() {
    return {
      violations: Array.from(this.peerViolations.entries()).map(([peerId, count]) => ({
        peerId: peerId.substring(0, 8),
        violations: count
      })),
      bannedPeers: this.getBanList().length,
      rateLimitEntries: this.messageRateLimits.size
    };
  }
}

export default SecurityManager;
