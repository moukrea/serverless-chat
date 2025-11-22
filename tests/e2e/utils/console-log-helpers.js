/**
 * Console Log Verification Helpers for Reconnection Testing
 *
 * Provides comprehensive console log capture and verification for
 * testing reconnection scenarios in Playwright E2E tests.
 *
 * Key Features:
 * - Non-invasive log capture (doesn't affect app behavior)
 * - Pattern-based verification for cold/warm starts
 * - Timing analysis between critical log events
 * - Clear error messages with context
 * - Works reliably in CI environments
 *
 * @module tests/e2e/utils/console-log-helpers
 */

// =============================================================================
// LOG PATTERN DEFINITIONS
// =============================================================================

/**
 * Critical log patterns that indicate reconnection flow stages
 */
export const RECONNECTION_LOG_PATTERNS = {
  // Master Reconnection Orchestration
  RECONNECTION_INITIATED: /MESH RECONNECTION INITIATED/,
  RECONNECTION_COMPLETE: /RECONNECTION COMPLETE/,

  // Cold Start Flow
  COLD_START_DETECTED: /COLD START.*No active connections/,
  COLD_START_INITIATED: /COLD START RECOVERY INITIATED/,
  COLD_START_LAYER_1: /Layer 1.*recent peers/,
  COLD_START_LAYER_2: /Layer 2.*knock protocol/,
  COLD_START_LAYER_3: /Layer 3.*all known peers/,
  COLD_START_LAYER_4: /Layer 4.*initial pairing/,
  COLD_START_SUCCESS: /Cold start successful via/,
  COLD_START_FAILURE: /RECOVERY FAILED.*All layers exhausted/,

  // Warm Start Flow
  WARM_START_DETECTED: /WARM START.*active connection.*detected/,
  WARM_START_ANNOUNCE: /Announcing presence to mesh/,
  WARM_START_TOPOLOGY: /Discovering mesh topology/,
  WARM_START_CANDIDATES: /Identifying reconnection candidates/,
  WARM_START_RECONNECTING: /Reconnecting to peers/,

  // Individual Peer Reconnection
  DIRECT_RECONNECTION_ATTEMPT: /DirectReconnection.*Attempting reconnection/,
  DIRECT_RECONNECTION_SUCCESS: /DirectReconnection.*Reconnected via/,
  MESH_RELAY_ATTEMPT: /ReconnectionManager.*Attempting reconnection/,
  MESH_RELAY_SUCCESS: /ReconnectionManager.*Successfully reconnected/,

  // Connection States
  PEER_CONNECTED: /Connected to.*peer/,
  PEER_DISCONNECTED: /disconnected|closed/i,

  // Topology Discovery
  TOPOLOGY_DISCOVERY_START: /Topology.*Starting discovery/,
  TOPOLOGY_DISCOVERY_COMPLETE: /Topology.*Discovery complete/,

  // Announcements
  ANNOUNCEMENT_SENT: /Presence announced/,
  PERIODIC_ANNOUNCEMENTS_START: /Started periodic announcements/,

  // Errors and Failures
  RECONNECTION_ERROR: /error|failed|exception/i,
  TIMEOUT: /timeout|timed out/i,
};

/**
 * Log sequences that must appear in order for valid reconnection
 */
export const LOG_SEQUENCES = {
  COLD_START: [
    'RECONNECTION_INITIATED',
    'COLD_START_DETECTED',
    'COLD_START_INITIATED',
  ],

  WARM_START: [
    'RECONNECTION_INITIATED',
    'WARM_START_DETECTED',
    'WARM_START_ANNOUNCE',
  ],

  SUCCESSFUL_RECONNECTION: [
    'RECONNECTION_INITIATED',
    'RECONNECTION_COMPLETE',
  ],
};

/**
 * Timing constraints for reconnection flow
 */
export const TIMING_CONSTRAINTS = {
  // Maximum time between critical events (milliseconds)
  MAX_RECONNECTION_DURATION: 60000,     // 60 seconds total
  MAX_COLD_START_DURATION: 45000,       // 45 seconds for cold start
  MAX_WARM_START_DURATION: 30000,       // 30 seconds for warm start
  MAX_PEER_RECONNECT_DURATION: 30000,   // 30 seconds per peer

  // Minimum time constraints (sanity checks)
  MIN_RECONNECTION_DURATION: 100,       // At least 100ms (not instant)
};

// =============================================================================
// LOG CAPTURE SYSTEM
// =============================================================================

/**
 * Capture and categorize console logs during reconnection
 *
 * Non-invasive log capture that collects all console output with
 * timestamps and categorization for later analysis.
 *
 * @param {Page} page - Playwright page object
 * @returns {Object} Log capture controller
 *
 * @example
 * const logCapture = captureReconnectionLogs(page);
 * await page.reload();
 * await waitForReconnection(page);
 * const logs = logCapture.getLogs();
 * console.log(`Captured ${logs.length} log entries`);
 */
export function captureReconnectionLogs(page) {
  const logs = [];
  const errors = [];
  const warnings = [];
  let captureStartTime = Date.now();
  let isCapturing = true;

  // Capture console messages
  const consoleHandler = (msg) => {
    if (!isCapturing) return;

    const timestamp = Date.now();
    const relativeTime = timestamp - captureStartTime;
    const type = msg.type();
    const text = msg.text();

    const entry = {
      timestamp,
      relativeTime,
      type,
      text,
      location: msg.location(),
    };

    logs.push(entry);

    // Categorize by type
    if (type === 'error') {
      errors.push(entry);
    } else if (type === 'warning') {
      warnings.push(entry);
    }
  };

  // Capture page errors
  const pageErrorHandler = (error) => {
    if (!isCapturing) return;

    const timestamp = Date.now();
    const relativeTime = timestamp - captureStartTime;

    const entry = {
      timestamp,
      relativeTime,
      type: 'pageerror',
      text: error.message,
      stack: error.stack,
    };

    logs.push(entry);
    errors.push(entry);
  };

  // Attach listeners
  page.on('console', consoleHandler);
  page.on('pageerror', pageErrorHandler);

  // Controller object
  return {
    /**
     * Get all captured logs
     * @returns {Array<Object>} Log entries
     */
    getLogs() {
      return [...logs];
    },

    /**
     * Get only error logs
     * @returns {Array<Object>} Error entries
     */
    getErrors() {
      return [...errors];
    },

    /**
     * Get only warning logs
     * @returns {Array<Object>} Warning entries
     */
    getWarnings() {
      return [...warnings];
    },

    /**
     * Get logs matching a pattern
     * @param {RegExp|string} pattern - Pattern to match
     * @returns {Array<Object>} Matching logs
     */
    getLogsMatching(pattern) {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
      return logs.filter(log => regex.test(log.text));
    },

    /**
     * Get logs within a time range
     * @param {number} startTime - Start time (relative ms)
     * @param {number} endTime - End time (relative ms)
     * @returns {Array<Object>} Logs in range
     */
    getLogsInTimeRange(startTime, endTime) {
      return logs.filter(log =>
        log.relativeTime >= startTime && log.relativeTime <= endTime
      );
    },

    /**
     * Reset capture start time
     */
    resetTimer() {
      captureStartTime = Date.now();
      logs.forEach(log => {
        log.relativeTime = log.timestamp - captureStartTime;
      });
    },

    /**
     * Stop capturing logs
     */
    stop() {
      isCapturing = false;
      page.off('console', consoleHandler);
      page.off('pageerror', pageErrorHandler);
    },

    /**
     * Resume capturing logs
     */
    resume() {
      isCapturing = true;
    },

    /**
     * Clear all captured logs
     */
    clear() {
      logs.length = 0;
      errors.length = 0;
      warnings.length = 0;
      captureStartTime = Date.now();
    },

    /**
     * Get summary statistics
     * @returns {Object} Statistics
     */
    getStats() {
      return {
        total: logs.length,
        errors: errors.length,
        warnings: warnings.length,
        byType: logs.reduce((acc, log) => {
          acc[log.type] = (acc[log.type] || 0) + 1;
          return acc;
        }, {}),
        duration: logs.length > 0
          ? logs[logs.length - 1].relativeTime
          : 0,
      };
    },

    /**
     * Export logs as formatted text
     * @returns {string} Formatted log output
     */
    export() {
      return logs.map(log =>
        `[${(log.relativeTime / 1000).toFixed(3)}s] [${log.type}] ${log.text}`
      ).join('\n');
    },
  };
}

// =============================================================================
// LOG PATTERN VERIFICATION
// =============================================================================

/**
 * Verify reconnection log pattern and sequence
 *
 * Analyzes captured logs to verify that reconnection occurred correctly,
 * checking for required log patterns, proper sequence, and timing.
 *
 * @param {Array<Object>} logs - Captured log entries
 * @param {Object} [options={}] - Verification options
 * @param {boolean} [options.strict=false] - Strict mode (fail on warnings)
 * @param {number} [options.maxDuration] - Maximum duration in ms
 * @returns {Object} Verification result
 *
 * @example
 * const logCapture = captureReconnectionLogs(page);
 * await page.reload();
 * await waitForReconnection(page);
 * const result = verifyReconnectionLogPattern(logCapture.getLogs());
 * expect(result.success).toBe(true);
 * expect(result.reconnectionType).toMatch(/cold_start|warm_start/);
 */
export function verifyReconnectionLogPattern(logs, options = {}) {
  const {
    strict = false,
    maxDuration = TIMING_CONSTRAINTS.MAX_RECONNECTION_DURATION,
  } = options;

  const result = {
    success: false,
    reconnectionType: null,
    errors: [],
    warnings: [],
    details: {},
    timeline: [],
  };

  if (!logs || logs.length === 0) {
    result.errors.push('No logs captured');
    return result;
  }

  // Build timeline of critical events
  const timeline = buildTimeline(logs);
  result.timeline = timeline;

  // Determine reconnection type
  const reconnectionType = detectReconnectionType(timeline);
  result.reconnectionType = reconnectionType;

  if (!reconnectionType) {
    result.errors.push('Could not determine reconnection type (cold/warm start)');
    return result;
  }

  // Verify based on type
  if (reconnectionType === 'cold_start') {
    verifyColdStartSequence(timeline, result);
  } else if (reconnectionType === 'warm_start') {
    verifyWarmStartSequence(timeline, result);
  }

  // Check timing constraints
  verifyTiming(timeline, result, maxDuration);

  // Check for errors in logs
  checkForLogErrors(logs, result);

  // Determine overall success
  result.success = result.errors.length === 0 &&
    (strict ? result.warnings.length === 0 : true);

  return result;
}

/**
 * Check for cold start specific log patterns
 *
 * Verifies that cold start recovery was initiated and completed correctly.
 * Checks for all expected layers and proper flow.
 *
 * @param {Array<Object>} logs - Captured log entries
 * @returns {Object} Cold start verification result
 *
 * @example
 * const result = checkForColdStartLogs(logCapture.getLogs());
 * expect(result.detected).toBe(true);
 * expect(result.successfulLayer).toBeDefined();
 * expect(result.layers.recent_peers.attempted).toBe(true);
 */
export function checkForColdStartLogs(logs) {
  const result = {
    detected: false,
    initiated: false,
    completed: false,
    successfulLayer: null,
    layers: {
      recent_peers: { attempted: false, success: false },
      knock_protocol: { attempted: false, success: false },
      all_known_peers: { attempted: false, success: false },
      initial_pairing: { attempted: false, success: false },
    },
    errors: [],
    warnings: [],
    details: {},
  };

  // Check if cold start was detected
  const coldStartDetected = logs.some(log =>
    RECONNECTION_LOG_PATTERNS.COLD_START_DETECTED.test(log.text)
  );

  if (!coldStartDetected) {
    return result;
  }

  result.detected = true;

  // Check if cold start was initiated
  result.initiated = logs.some(log =>
    RECONNECTION_LOG_PATTERNS.COLD_START_INITIATED.test(log.text)
  );

  if (!result.initiated) {
    result.errors.push('Cold start detected but not initiated');
  }

  // Check Layer 1: Recent Peers
  const layer1Logs = logs.filter(log => /Layer 1.*recent peers/i.test(log.text));
  if (layer1Logs.length > 0) {
    result.layers.recent_peers.attempted = true;
    result.layers.recent_peers.success = logs.some(log =>
      /Success via Layer 1|recent_peers/.test(log.text)
    );
  }

  // Check Layer 2: Knock Protocol
  const layer2Logs = logs.filter(log => /Layer 2.*knock protocol/i.test(log.text));
  if (layer2Logs.length > 0) {
    result.layers.knock_protocol.attempted = true;
    result.layers.knock_protocol.success = logs.some(log =>
      /Success via Layer 2|knock_protocol/.test(log.text)
    );
  }

  // Check Layer 3: All Known Peers
  const layer3Logs = logs.filter(log => /Layer 3.*all known peers/i.test(log.text));
  if (layer3Logs.length > 0) {
    result.layers.all_known_peers.attempted = true;
    result.layers.all_known_peers.success = logs.some(log =>
      /Success via Layer 3|all_known_peers/.test(log.text)
    );
  }

  // Check Layer 4: Initial Pairing
  const layer4Logs = logs.filter(log => /Layer 4.*initial pairing/i.test(log.text));
  if (layer4Logs.length > 0) {
    result.layers.initial_pairing.attempted = true;
    result.layers.initial_pairing.success = logs.some(log =>
      /Success via Layer 4|initial_pairing/.test(log.text)
    );
  }

  // Determine successful layer
  for (const [layerName, layerData] of Object.entries(result.layers)) {
    if (layerData.success) {
      result.successfulLayer = layerName;
      result.completed = true;
      break;
    }
  }

  // Check for complete failure
  const completeFailure = logs.some(log =>
    RECONNECTION_LOG_PATTERNS.COLD_START_FAILURE.test(log.text)
  );

  if (completeFailure) {
    result.completed = true;
    result.errors.push('Cold start failed completely - all layers exhausted');
  }

  // Verify expected sequence
  if (result.initiated && !result.completed) {
    result.warnings.push('Cold start initiated but did not complete');
  }

  return result;
}

/**
 * Check for warm start specific log patterns
 *
 * Verifies that warm start reconnection was performed correctly,
 * with proper mesh announcement and peer reconnection.
 *
 * @param {Array<Object>} logs - Captured log entries
 * @returns {Object} Warm start verification result
 *
 * @example
 * const result = checkForWarmStartLogs(logCapture.getLogs());
 * expect(result.detected).toBe(true);
 * expect(result.announcementSent).toBe(true);
 * expect(result.peersReconnected).toBeGreaterThan(0);
 */
export function checkForWarmStartLogs(logs) {
  const result = {
    detected: false,
    announcementSent: false,
    topologyDiscovered: false,
    candidatesIdentified: false,
    peersReconnected: 0,
    reconnectionMethods: {
      direct: 0,
      relay: 0,
    },
    errors: [],
    warnings: [],
    details: {},
  };

  // Check if warm start was detected
  const warmStartDetected = logs.some(log =>
    RECONNECTION_LOG_PATTERNS.WARM_START_DETECTED.test(log.text)
  );

  if (!warmStartDetected) {
    return result;
  }

  result.detected = true;

  // Check announcement
  result.announcementSent = logs.some(log =>
    RECONNECTION_LOG_PATTERNS.WARM_START_ANNOUNCE.test(log.text) ||
    RECONNECTION_LOG_PATTERNS.ANNOUNCEMENT_SENT.test(log.text)
  );

  if (!result.announcementSent) {
    result.warnings.push('Warm start detected but no announcement sent');
  }

  // Check topology discovery
  result.topologyDiscovered = logs.some(log =>
    RECONNECTION_LOG_PATTERNS.TOPOLOGY_DISCOVERY_COMPLETE.test(log.text)
  );

  // Check candidates identified
  result.candidatesIdentified = logs.some(log =>
    /Found.*reconnection candidate/i.test(log.text)
  );

  // Count reconnected peers
  const directSuccessLogs = logs.filter(log =>
    /Success via direct|direct_cached/.test(log.text)
  );
  result.reconnectionMethods.direct = directSuccessLogs.length;

  const relaySuccessLogs = logs.filter(log =>
    /Success via.*relay|mesh_relay/.test(log.text)
  );
  result.reconnectionMethods.relay = relaySuccessLogs.length;

  result.peersReconnected =
    result.reconnectionMethods.direct +
    result.reconnectionMethods.relay;

  // Extract details
  const newConnectionsMatch = logs.find(log =>
    /New connections: (\d+)/.test(log.text)
  );

  if (newConnectionsMatch) {
    const match = newConnectionsMatch.text.match(/New connections: (\d+)/);
    if (match) {
      result.details.newConnections = parseInt(match[1], 10);
    }
  }

  // Verify flow
  if (result.detected && !result.announcementSent) {
    result.errors.push('Warm start flow incomplete: missing announcement');
  }

  return result;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build timeline of critical reconnection events
 * @private
 */
function buildTimeline(logs) {
  const timeline = [];

  for (const [patternName, pattern] of Object.entries(RECONNECTION_LOG_PATTERNS)) {
    const matchingLogs = logs.filter(log => pattern.test(log.text));
    matchingLogs.forEach(log => {
      timeline.push({
        event: patternName,
        timestamp: log.timestamp,
        relativeTime: log.relativeTime,
        text: log.text,
      });
    });
  }

  // Sort by relative time
  timeline.sort((a, b) => a.relativeTime - b.relativeTime);

  return timeline;
}

/**
 * Detect reconnection type from timeline
 * @private
 */
function detectReconnectionType(timeline) {
  const hasColdStart = timeline.some(e => e.event === 'COLD_START_DETECTED');
  const hasWarmStart = timeline.some(e => e.event === 'WARM_START_DETECTED');

  if (hasColdStart) return 'cold_start';
  if (hasWarmStart) return 'warm_start';
  return null;
}

/**
 * Verify cold start sequence
 * @private
 */
function verifyColdStartSequence(timeline, result) {
  const requiredEvents = ['RECONNECTION_INITIATED', 'COLD_START_DETECTED'];
  const missingEvents = requiredEvents.filter(
    event => !timeline.some(e => e.event === event)
  );

  if (missingEvents.length > 0) {
    result.errors.push(
      `Cold start missing required events: ${missingEvents.join(', ')}`
    );
  }

  // Check completion
  const hasCompletion = timeline.some(e =>
    e.event === 'COLD_START_SUCCESS' || e.event === 'RECONNECTION_COMPLETE'
  );

  if (!hasCompletion) {
    result.warnings.push('Cold start did not complete successfully');
  }
}

/**
 * Verify warm start sequence
 * @private
 */
function verifyWarmStartSequence(timeline, result) {
  const requiredEvents = ['RECONNECTION_INITIATED', 'WARM_START_DETECTED'];
  const missingEvents = requiredEvents.filter(
    event => !timeline.some(e => e.event === event)
  );

  if (missingEvents.length > 0) {
    result.errors.push(
      `Warm start missing required events: ${missingEvents.join(', ')}`
    );
  }

  // Check announcement
  const hasAnnouncement = timeline.some(e =>
    e.event === 'WARM_START_ANNOUNCE' || e.event === 'ANNOUNCEMENT_SENT'
  );

  if (!hasAnnouncement) {
    result.warnings.push('Warm start missing presence announcement');
  }
}

/**
 * Verify timing constraints
 * @private
 */
function verifyTiming(timeline, result, maxDuration) {
  if (timeline.length < 2) return;

  const startEvent = timeline.find(e => e.event === 'RECONNECTION_INITIATED');
  const endEvent = timeline.find(e => e.event === 'RECONNECTION_COMPLETE');

  if (startEvent && endEvent) {
    const duration = endEvent.relativeTime - startEvent.relativeTime;
    result.details.duration = duration;

    if (duration > maxDuration) {
      result.warnings.push(
        `Reconnection took ${duration}ms, exceeds maximum ${maxDuration}ms`
      );
    }

    if (duration < TIMING_CONSTRAINTS.MIN_RECONNECTION_DURATION) {
      result.errors.push(
        `Reconnection suspiciously fast: ${duration}ms (minimum ${TIMING_CONSTRAINTS.MIN_RECONNECTION_DURATION}ms)`
      );
    }
  }
}

/**
 * Check for errors in logs
 * @private
 */
function checkForLogErrors(logs, result) {
  const errorLogs = logs.filter(log =>
    log.type === 'error' || log.type === 'pageerror'
  );

  const criticalErrors = errorLogs.filter(log =>
    /fatal|critical|exception|unhandled/i.test(log.text)
  );

  if (criticalErrors.length > 0) {
    result.errors.push(
      `Found ${criticalErrors.length} critical error(s) in console`
    );
    result.details.criticalErrors = criticalErrors.map(e => e.text);
  }

  if (errorLogs.length > 0) {
    result.warnings.push(
      `Found ${errorLogs.length} error(s) in console (may be non-critical)`
    );
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  captureReconnectionLogs,
  verifyReconnectionLogPattern,
  checkForColdStartLogs,
  checkForWarmStartLogs,
  RECONNECTION_LOG_PATTERNS,
  LOG_SEQUENCES,
  TIMING_CONSTRAINTS,
};
