/**
 * NetworkChangeDetector Tests
 *
 * Tests for network change detection and IP monitoring functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import NetworkChangeDetector from './change-detector.js';

// =============================================================================
// TEST SETUP
// =============================================================================

describe('NetworkChangeDetector', () => {
  let detector;
  let mockReconnector;
  let originalNavigator;
  let originalWindow;

  beforeEach(() => {
    // Create mock reconnector
    mockReconnector = {
      handleIpChange: vi.fn().mockResolvedValue(true)
    };

    // Mock localStorage
    global.localStorage = {
      data: {},
      getItem(key) {
        return this.data[key] || null;
      },
      setItem(key, value) {
        this.data[key] = value;
      },
      clear() {
        this.data = {};
      }
    };

    // Save original navigator
    originalNavigator = global.navigator;

    // Mock navigator
    global.navigator = {
      onLine: true,
      connection: {
        effectiveType: '4g',
        type: 'wifi',
        downlink: 10,
        rtt: 50,
        saveData: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }
    };

    // Mock window
    originalWindow = global.window;
    global.window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      RTCPeerConnection: vi.fn()
    };

    // Clear localStorage before each test
    localStorage.clear();

    // Create detector instance
    detector = new NetworkChangeDetector(mockReconnector);
  });

  afterEach(() => {
    // Clean up
    if (detector) {
      detector.destroy();
    }

    // Restore original objects
    global.navigator = originalNavigator;
    global.window = originalWindow;
  });

  // ===========================================================================
  // CONSTRUCTOR TESTS
  // ===========================================================================

  describe('Constructor', () => {
    it('should initialize with correct default values', () => {
      expect(detector.reconnector).toBe(mockReconnector);
      expect(detector.ipChangeCount).toBe(0);
      expect(detector.connectionTypeChangeCount).toBe(0);
      expect(detector.onlineCount).toBe(0);
      expect(detector.offlineCount).toBe(0);
    });

    it('should detect available browser APIs', () => {
      expect(detector.hasNetworkInfo).toBe(true);
      expect(detector.hasWebRTC).toBe(true);
    });

    it('should handle missing Network Information API', () => {
      delete global.navigator.connection;
      const detector2 = new NetworkChangeDetector(mockReconnector);

      expect(detector2.hasNetworkInfo).toBe(false);
    });

    it('should handle missing WebRTC', () => {
      delete global.window.RTCPeerConnection;
      delete global.window.webkitRTCPeerConnection;
      const detector2 = new NetworkChangeDetector(mockReconnector);

      expect(detector2.hasWebRTC).toBe(false);
    });
  });

  // ===========================================================================
  // INITIALIZATION TESTS
  // ===========================================================================

  describe('initialize()', () => {
    it('should set up event listeners', () => {
      detector.initialize();

      // Check that event listeners were registered
      expect(global.window.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
      expect(global.window.addEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
      expect(global.navigator.connection.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should store initial connection type', () => {
      detector.initialize();

      expect(detector.lastConnectionType).toBe('wifi');
    });

    it('should start periodic IP checking', () => {
      vi.useFakeTimers();
      detector.initialize();

      expect(detector.ipCheckInterval).toBeDefined();

      vi.useRealTimers();
    });

    it('should record initial online time if online', () => {
      global.navigator.onLine = true;
      detector.initialize();

      expect(detector.lastOnlineTime).toBeDefined();
      expect(detector.lastOfflineTime).toBeNull();
    });

    it('should record initial offline time if offline', () => {
      global.navigator.onLine = false;
      detector.initialize();

      expect(detector.lastOfflineTime).toBeDefined();
      expect(detector.lastOnlineTime).toBeNull();
    });
  });

  // ===========================================================================
  // CONNECTION TYPE TESTS
  // ===========================================================================

  describe('getConnectionType()', () => {
    it('should return connection type when available', () => {
      const type = detector.getConnectionType();
      expect(type).toBe('wifi');
    });

    it('should return effectiveType if type is unknown', () => {
      global.navigator.connection.type = 'unknown';
      const type = detector.getConnectionType();
      expect(type).toBe('4g');
    });

    it('should return effectiveType if type is missing', () => {
      delete global.navigator.connection.type;
      const type = detector.getConnectionType();
      expect(type).toBe('4g');
    });

    it('should return unknown if API not available', () => {
      delete global.navigator.connection;
      const detector2 = new NetworkChangeDetector(mockReconnector);
      const type = detector2.getConnectionType();
      expect(type).toBe('unknown');
    });
  });

  // ===========================================================================
  // NETWORK CHANGE HANDLING TESTS
  // ===========================================================================

  describe('handleNetworkChange()', () => {
    beforeEach(() => {
      detector.initialize();
    });

    it('should detect connection type change', async () => {
      detector.lastConnectionType = 'wifi';
      global.navigator.connection.type = 'cellular';

      await detector.handleNetworkChange();

      expect(detector.connectionTypeChangeCount).toBe(1);
      expect(detector.lastConnectionType).toBe('cellular');
    });

    it('should not increment counter if type unchanged', async () => {
      detector.lastConnectionType = 'wifi';
      global.navigator.connection.type = 'wifi';

      await detector.handleNetworkChange();

      expect(detector.connectionTypeChangeCount).toBe(0);
    });

    it('should skip IP check if offline', async () => {
      global.navigator.onLine = false;
      const checkSpy = vi.spyOn(detector, 'checkPublicIP');

      await detector.handleNetworkChange();

      expect(checkSpy).not.toHaveBeenCalled();
    });

    it('should check IP if online', async () => {
      global.navigator.onLine = true;
      const checkSpy = vi.spyOn(detector, 'checkPublicIP').mockResolvedValue();

      await detector.handleNetworkChange();

      // Should be called after 2 second delay
      await new Promise(resolve => setTimeout(resolve, 2100));
      expect(checkSpy).toHaveBeenCalled();
    }, 10000);
  });

  // ===========================================================================
  // ONLINE/OFFLINE HANDLING TESTS
  // ===========================================================================

  describe('handleOnline()', () => {
    beforeEach(() => {
      detector.initialize();
    });

    it('should increment online counter', async () => {
      await detector.handleOnline();
      expect(detector.onlineCount).toBe(1);
    });

    it('should record online timestamp', async () => {
      const before = Date.now();
      await detector.handleOnline();
      const after = Date.now();

      expect(detector.lastOnlineTime).toBeGreaterThanOrEqual(before);
      expect(detector.lastOnlineTime).toBeLessThanOrEqual(after);
    });

    it('should calculate offline duration', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      detector.lastOfflineTime = Date.now() - 5000; // 5 seconds ago

      await detector.handleOnline();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Was offline for')
      );
    });

    it('should check IP after coming online', async () => {
      const checkSpy = vi.spyOn(detector, 'checkPublicIP').mockResolvedValue();

      await detector.handleOnline();

      // Should be called after 2 second delay
      await new Promise(resolve => setTimeout(resolve, 2100));
      expect(checkSpy).toHaveBeenCalled();
    }, 10000);
  });

  describe('handleOffline()', () => {
    beforeEach(() => {
      detector.initialize();
    });

    it('should increment offline counter', () => {
      detector.handleOffline();
      expect(detector.offlineCount).toBe(1);
    });

    it('should record offline timestamp', () => {
      const before = Date.now();
      detector.handleOffline();
      const after = Date.now();

      expect(detector.lastOfflineTime).toBeGreaterThanOrEqual(before);
      expect(detector.lastOfflineTime).toBeLessThanOrEqual(after);
    });

    it('should calculate online duration', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      detector.lastOnlineTime = Date.now() - 10000; // 10 seconds ago

      detector.handleOffline();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Was online for')
      );
    });
  });

  // ===========================================================================
  // IP DETECTION TESTS
  // ===========================================================================

  describe('getPublicIP()', () => {
    it('should return null if WebRTC not available', async () => {
      detector.hasWebRTC = false;
      const ip = await detector.getPublicIP();
      expect(ip).toBeNull();
    });

    it('should return null on error', async () => {
      global.window.RTCPeerConnection = vi.fn().mockImplementation(() => {
        throw new Error('WebRTC error');
      });

      const ip = await detector.getPublicIP();
      expect(ip).toBeNull();
    });

    // Note: Full WebRTC mocking is complex, so we test error cases
    // Integration tests should test actual STUN functionality
  });

  describe('checkPublicIP()', () => {
    it('should store IP on first check', async () => {
      vi.spyOn(detector, 'getPublicIP').mockResolvedValue('203.0.113.42');

      await detector.checkPublicIP();

      expect(localStorage.getItem('lastKnownPublicIP')).toBe('203.0.113.42');
      expect(detector.lastKnownIP).toBe('203.0.113.42');
    });

    it('should detect IP change', async () => {
      localStorage.setItem('lastKnownPublicIP', '203.0.113.1');
      vi.spyOn(detector, 'getPublicIP').mockResolvedValue('203.0.113.42');

      await detector.checkPublicIP();

      expect(detector.ipChangeCount).toBe(1);
      expect(localStorage.getItem('lastKnownPublicIP')).toBe('203.0.113.42');
    });

    it('should call handleIpChange on IP change', async () => {
      localStorage.setItem('lastKnownPublicIP', '203.0.113.1');
      vi.spyOn(detector, 'getPublicIP').mockResolvedValue('203.0.113.42');

      await detector.checkPublicIP();

      expect(mockReconnector.handleIpChange).toHaveBeenCalled();
    });

    it('should not call handleIpChange if IP unchanged', async () => {
      localStorage.setItem('lastKnownPublicIP', '203.0.113.42');
      vi.spyOn(detector, 'getPublicIP').mockResolvedValue('203.0.113.42');

      await detector.checkPublicIP();

      expect(mockReconnector.handleIpChange).not.toHaveBeenCalled();
    });

    it('should handle null IP gracefully', async () => {
      vi.spyOn(detector, 'getPublicIP').mockResolvedValue(null);
      const consoleSpy = vi.spyOn(console, 'warn');

      await detector.checkPublicIP();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not determine public IP')
      );
    });

    it('should handle reconnector errors gracefully', async () => {
      localStorage.setItem('lastKnownPublicIP', '203.0.113.1');
      vi.spyOn(detector, 'getPublicIP').mockResolvedValue('203.0.113.42');
      mockReconnector.handleIpChange.mockRejectedValue(new Error('Reconnect failed'));

      const consoleSpy = vi.spyOn(console, 'error');

      await detector.checkPublicIP();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error handling IP change'),
        expect.any(Error)
      );
    });

    it('should warn if reconnector missing handleIpChange', async () => {
      const detectorNoMethod = new NetworkChangeDetector({});
      localStorage.setItem('lastKnownPublicIP', '203.0.113.1');
      vi.spyOn(detectorNoMethod, 'getPublicIP').mockResolvedValue('203.0.113.42');
      const consoleSpy = vi.spyOn(console, 'warn');

      await detectorNoMethod.checkPublicIP();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No reconnector.handleIpChange()')
      );

      detectorNoMethod.destroy();
    });
  });

  // ===========================================================================
  // STATISTICS TESTS
  // ===========================================================================

  describe('getStats()', () => {
    it('should return comprehensive statistics', () => {
      detector.ipChangeCount = 3;
      detector.connectionTypeChangeCount = 2;
      detector.onlineCount = 5;
      detector.offlineCount = 4;
      localStorage.setItem('lastKnownPublicIP', '203.0.113.42');

      const stats = detector.getStats();

      expect(stats).toMatchObject({
        isOnline: true,
        currentConnectionType: 'wifi',
        lastKnownIP: '203.0.113.42',
        ipChangeCount: 3,
        connectionTypeChangeCount: 2,
        onlineCount: 5,
        offlineCount: 4
      });

      expect(stats.features).toMatchObject({
        networkInfo: true,
        webRTC: true,
        onlineAPI: true
      });
    });

    it('should calculate uptime correctly', () => {
      const before = Date.now();
      const stats = detector.getStats();
      const after = Date.now();

      expect(stats.totalUptime).toBeGreaterThanOrEqual(0);
      expect(stats.totalUptime).toBeLessThanOrEqual(after - before + 100);
    });

    it('should include connection info when available', () => {
      const stats = detector.getStats();

      expect(stats.connectionInfo).toBeDefined();
      expect(stats.connectionInfo.effectiveType).toBe('4g');
      expect(stats.connectionInfo.type).toBe('wifi');
    });

    it('should handle missing connection info', () => {
      delete global.navigator.connection;
      const detector2 = new NetworkChangeDetector(mockReconnector);

      const stats = detector2.getStats();

      expect(stats.connectionInfo).toEqual({});
      detector2.destroy();
    });
  });

  describe('getStatusSummary()', () => {
    it('should return human-readable summary', () => {
      detector.ipChangeCount = 2;
      localStorage.setItem('lastKnownPublicIP', '203.0.113.42');

      const summary = detector.getStatusSummary();

      expect(summary).toContain('ONLINE');
      expect(summary).toContain('wifi');
      expect(summary).toContain('203.0.113.42');
      expect(summary).toContain('IP Changes: 2');
    });

    it('should show offline status', () => {
      global.navigator.onLine = false;

      const summary = detector.getStatusSummary();

      expect(summary).toContain('OFFLINE');
    });
  });

  // ===========================================================================
  // CLEANUP TESTS
  // ===========================================================================

  describe('destroy()', () => {
    beforeEach(() => {
      detector.initialize();
    });

    it('should clear interval', () => {
      detector.destroy();
      expect(detector.ipCheckInterval).toBeNull();
    });

    it('should clear pending timeout', () => {
      detector.changeTimeout = setTimeout(() => {}, 1000);
      detector.destroy();
      expect(detector.changeTimeout).toBeNull();
    });

    it('should remove event listeners', () => {
      detector.destroy();

      expect(global.navigator.connection.removeEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function)
      );
      expect(global.window.removeEventListener).toHaveBeenCalledWith(
        'online',
        expect.any(Function)
      );
      expect(global.window.removeEventListener).toHaveBeenCalledWith(
        'offline',
        expect.any(Function)
      );
    });

    it('should handle missing connection gracefully', () => {
      delete global.navigator.connection;
      const detector2 = new NetworkChangeDetector(mockReconnector);
      detector2.initialize();

      expect(() => detector2.destroy()).not.toThrow();
    });
  });

  // ===========================================================================
  // INTEGRATION TESTS
  // ===========================================================================

  describe('Integration', () => {
    it('should handle rapid network changes with debouncing', async () => {
      vi.useFakeTimers();
      detector.initialize();

      const checkSpy = vi.spyOn(detector, 'checkPublicIP').mockResolvedValue();

      // Simulate rapid connection changes
      detector.connectionChangeListener();
      detector.connectionChangeListener();
      detector.connectionChangeListener();

      // Fast-forward through debounce timeout
      vi.advanceTimersByTime(1000);

      // Should only check once due to debouncing
      expect(checkSpy).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should track multiple IP changes correctly', async () => {
      vi.spyOn(detector, 'getPublicIP')
        .mockResolvedValueOnce('203.0.113.1')
        .mockResolvedValueOnce('203.0.113.2')
        .mockResolvedValueOnce('203.0.113.3');

      await detector.checkPublicIP(); // Initial
      expect(detector.ipChangeCount).toBe(0);

      await detector.checkPublicIP(); // Change 1
      expect(detector.ipChangeCount).toBe(1);

      await detector.checkPublicIP(); // Change 2
      expect(detector.ipChangeCount).toBe(2);
    });

    it('should handle complete offline → online cycle', async () => {
      detector.initialize();

      // Go offline
      detector.handleOffline();
      expect(detector.offlineCount).toBe(1);
      expect(detector.lastOfflineTime).toBeDefined();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Come back online
      await detector.handleOnline();
      expect(detector.onlineCount).toBe(1);
      expect(detector.lastOnlineTime).toBeDefined();

      const stats = detector.getStats();
      expect(stats.offlineCount).toBe(1);
      expect(stats.onlineCount).toBe(1);
    });
  });
});
