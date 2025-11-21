/**
 * Test Suite for Peer Reconnection Authentication
 *
 * Run in browser console or with a test framework
 */

import ReconnectionAuth from './reconnection-auth.js';

// ============================================================================
// Test Utilities
// ============================================================================

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  async test(name, fn) {
    try {
      console.log(`\n🧪 Testing: ${name}`);
      await fn();
      console.log(`✅ PASS: ${name}`);
      this.passed++;
    } catch (e) {
      console.error(`❌ FAIL: ${name}`);
      console.error(e);
      this.failed++;
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  async runAll() {
    console.log('\n' + '='.repeat(80));
    console.log('Reconnection Authentication Test Suite');
    console.log('='.repeat(80));

    await this.testBasicInitialization();
    await this.testIdentityExchange();
    await this.testAnnouncementCreation();
    await this.testAnnouncementVerification();
    await this.testReplayProtection();
    await this.testTimestampValidation();
    await this.testSequenceNumberValidation();
    await this.testRelayEnvelope();
    await this.testTOFU();
    await this.testKeyMismatch();

    console.log('\n' + '='.repeat(80));
    console.log(`Results: ${this.passed} passed, ${this.failed} failed`);
    console.log('='.repeat(80));

    return this.failed === 0;
  }

  // ========================================================================
  // Test Cases
  // ========================================================================

  async testBasicInitialization() {
    await this.test('Basic Initialization', async () => {
      const identity = { peerId: 'TEST_A', displayName: 'Test Peer A' };
      const auth = new ReconnectionAuth(identity);
      await auth.initialize();

      this.assert(auth.signKeyPair !== null, 'Sign key pair should be generated');
      this.assert(auth.dhKeyPair !== null, 'DH key pair should be generated');
      this.assert(auth.algorithm !== null, 'Algorithm should be set');
      this.assert(auth.sequenceCounter === 0, 'Sequence counter should start at 0');

      auth.destroy();
    });
  }

  async testIdentityExchange() {
    await this.test('Identity Exchange', async () => {
      const identityA = { peerId: 'TEST_A', displayName: 'Test Peer A' };
      const identityB = { peerId: 'TEST_B', displayName: 'Test Peer B' };

      const authA = new ReconnectionAuth(identityA);
      const authB = new ReconnectionAuth(identityB);

      await authA.initialize();
      await authB.initialize();

      // Simulate identity exchange
      const mockPeer = {
        send: (data) => {
          // Simulate receiving on the other end
          setTimeout(async () => {
            const message = JSON.parse(data);
            const result = await authB.handleIdentityExchange(message, identityA.peerId);
            this.assert(result.valid === true, 'Identity exchange should be valid');
          }, 10);
        }
      };

      await authA.exchangeIdentity(mockPeer, identityB.peerId);

      // Wait for async handling
      await new Promise(resolve => setTimeout(resolve, 50));

      authA.destroy();
      authB.destroy();
    });
  }

  async testAnnouncementCreation() {
    await this.test('Announcement Creation', async () => {
      const identity = { peerId: 'TEST_A', displayName: 'Test Peer A' };
      const auth = new ReconnectionAuth(identity);
      await auth.initialize();

      const announcement = await auth.createAnnouncement(['PEER_B', 'PEER_C']);

      this.assert(announcement.type === 'peer_reconnection', 'Should have correct type');
      this.assert(announcement.peerId === 'TEST_A', 'Should have correct peerId');
      this.assert(announcement.timestamp > 0, 'Should have timestamp');
      this.assert(announcement.nonce.length === 64, 'Should have 32-byte nonce (64 hex chars)');
      this.assert(announcement.sequenceNum === 1, 'Should have sequence number');
      this.assert(announcement.signature !== null, 'Should be signed');
      this.assert(Array.isArray(announcement.previousConnections), 'Should have previous connections');

      auth.destroy();
    });
  }

  async testAnnouncementVerification() {
    await this.test('Announcement Verification', async () => {
      const identityA = { peerId: 'TEST_A', displayName: 'Test Peer A' };
      const identityB = { peerId: 'TEST_B', displayName: 'Test Peer B' };

      const authA = new ReconnectionAuth(identityA);
      const authB = new ReconnectionAuth(identityB);

      await authA.initialize();
      await authB.initialize();

      // B must trust A first (simulate initial connection)
      await authB.trustStore.addPeer(
        identityA.peerId,
        authA.signKeyPair.publicKey,
        authA.algorithm
      );

      // A creates announcement
      const announcement = await authA.createAnnouncement();

      // B verifies announcement
      const result = await authB.verifyAnnouncement(announcement);

      this.assert(result.valid === true, 'Announcement should be valid');
      this.assert(result.peerId === 'TEST_A', 'Should have correct peerId');

      authA.destroy();
      authB.destroy();
    });
  }

  async testReplayProtection() {
    await this.test('Replay Attack Protection', async () => {
      const identityA = { peerId: 'TEST_A', displayName: 'Test Peer A' };
      const identityB = { peerId: 'TEST_B', displayName: 'Test Peer B' };

      const authA = new ReconnectionAuth(identityA);
      const authB = new ReconnectionAuth(identityB);

      await authA.initialize();
      await authB.initialize();

      // Setup trust
      await authB.trustStore.addPeer(
        identityA.peerId,
        authA.signKeyPair.publicKey,
        authA.algorithm
      );

      // A creates announcement
      const announcement = await authA.createAnnouncement();

      // B verifies announcement (first time - should succeed)
      const result1 = await authB.verifyAnnouncement(announcement);
      this.assert(result1.valid === true, 'First verification should succeed');

      // Try to replay the same announcement (should fail)
      const result2 = await authB.verifyAnnouncement(announcement);
      this.assert(result2.valid === false, 'Replay should be rejected');
      this.assert(result2.reason === 'nonce_reused', 'Should detect nonce reuse');

      authA.destroy();
      authB.destroy();
    });
  }

  async testTimestampValidation() {
    await this.test('Timestamp Validation', async () => {
      const identityA = { peerId: 'TEST_A', displayName: 'Test Peer A' };
      const identityB = { peerId: 'TEST_B', displayName: 'Test Peer B' };

      const authA = new ReconnectionAuth(identityA);
      const authB = new ReconnectionAuth(identityB);

      await authA.initialize();
      await authB.initialize();

      // Setup trust
      await authB.trustStore.addPeer(
        identityA.peerId,
        authA.signKeyPair.publicKey,
        authA.algorithm
      );

      // Create announcement with old timestamp
      const announcement = await authA.createAnnouncement();
      announcement.timestamp = Date.now() - (10 * 60 * 1000); // 10 minutes ago

      // Re-sign with old timestamp (simulate attacker)
      const payload = JSON.stringify({
        type: announcement.type,
        peerId: announcement.peerId,
        displayName: announcement.displayName,
        timestamp: announcement.timestamp,
        nonce: announcement.nonce,
        sequenceNum: announcement.sequenceNum,
        previousConnections: announcement.previousConnections,
      }, Object.keys(announcement).sort());

      announcement.signature = await authA.sign(payload);

      // B should reject due to old timestamp
      const result = await authB.verifyAnnouncement(announcement);
      this.assert(result.valid === false, 'Old announcement should be rejected');
      this.assert(result.reason === 'timestamp_out_of_range', 'Should detect old timestamp');

      authA.destroy();
      authB.destroy();
    });
  }

  async testSequenceNumberValidation() {
    await this.test('Sequence Number Validation', async () => {
      const identityA = { peerId: 'TEST_A', displayName: 'Test Peer A' };
      const identityB = { peerId: 'TEST_B', displayName: 'Test Peer B' };

      const authA = new ReconnectionAuth(identityA);
      const authB = new ReconnectionAuth(identityB);

      await authA.initialize();
      await authB.initialize();

      // Setup trust
      await authB.trustStore.addPeer(
        identityA.peerId,
        authA.signKeyPair.publicKey,
        authA.algorithm
      );

      // A creates two announcements
      const announcement1 = await authA.createAnnouncement();
      const announcement2 = await authA.createAnnouncement();

      // B verifies first (sequence 1)
      const result1 = await authB.verifyAnnouncement(announcement1);
      this.assert(result1.valid === true, 'First announcement should be valid');

      // B verifies second (sequence 2)
      const result2 = await authB.verifyAnnouncement(announcement2);
      this.assert(result2.valid === true, 'Second announcement should be valid');

      // Try to replay first (sequence 1) - should fail
      const result3 = await authB.verifyAnnouncement(announcement1);
      this.assert(result3.valid === false, 'Old sequence should be rejected');
      this.assert(result3.reason === 'sequence_number_not_incremented', 'Should detect sequence rollback');

      authA.destroy();
      authB.destroy();
    });
  }

  async testRelayEnvelope() {
    await this.test('Relay Envelope', async () => {
      const identityA = { peerId: 'TEST_A', displayName: 'Test Peer A' };
      const identityB = { peerId: 'TEST_B', displayName: 'Test Peer B' };
      const identityC = { peerId: 'TEST_C', displayName: 'Test Peer C' };

      const authA = new ReconnectionAuth(identityA);
      const authB = new ReconnectionAuth(identityB);
      const authC = new ReconnectionAuth(identityC);

      await authA.initialize();
      await authB.initialize();
      await authC.initialize();

      // Setup trust relationships
      // A trusts B (direct connection)
      await authA.trustStore.addPeer(
        identityB.peerId,
        authB.signKeyPair.publicKey,
        authB.algorithm
      );

      // A trusts C (relay peer)
      await authA.trustStore.addPeer(
        identityC.peerId,
        authC.signKeyPair.publicKey,
        authC.algorithm
      );

      // B creates announcement
      const announcement = await authB.createAnnouncement();

      // C creates relay envelope
      const envelope = await authC.createRelayEnvelope(announcement);

      this.assert(envelope.type === 'relayed_announcement', 'Should have correct type');
      this.assert(envelope.relayedBy === 'TEST_C', 'Should have relayer ID');
      this.assert(envelope.relaySignature !== null, 'Should have relay signature');

      // A verifies relayed announcement
      const result = await authA.verifyRelayedAnnouncement(envelope);
      this.assert(result.valid === true, 'Relayed announcement should be valid');
      this.assert(result.peerId === 'TEST_B', 'Should have original peerId');
      this.assert(result.relayedBy === 'TEST_C', 'Should have relayer ID');

      authA.destroy();
      authB.destroy();
      authC.destroy();
    });
  }

  async testTOFU() {
    await this.test('Trust On First Use (TOFU)', async () => {
      const identityA = { peerId: 'TEST_A', displayName: 'Test Peer A' };
      const authA = new ReconnectionAuth(identityA);
      await authA.initialize();

      // First time seeing a peer - should be accepted
      const mockPublicKey = { kty: 'OKP', crv: 'Ed25519', x: 'test123' };

      await authA.trustStore.addPeer('PEER_B', mockPublicKey, 'Ed25519');

      this.assert(authA.trustStore.isTrusted('PEER_B'), 'Peer should be trusted after first use');

      // Verify stored key matches
      const stored = authA.trustStore.getPeer('PEER_B');
      this.assert(JSON.stringify(stored.signPublicKey) === JSON.stringify(mockPublicKey), 'Stored key should match');

      authA.destroy();
    });
  }

  async testKeyMismatch() {
    await this.test('Key Mismatch Detection', async () => {
      const identityA = { peerId: 'TEST_A', displayName: 'Test Peer A' };
      const authA = new ReconnectionAuth(identityA);
      await authA.initialize();

      // First connection - add peer
      const firstKey = { kty: 'OKP', crv: 'Ed25519', x: 'first_key_123' };
      await authA.trustStore.addPeer('PEER_B', firstKey, 'Ed25519');

      // Attacker tries to connect with different key
      const attackerKey = { kty: 'OKP', crv: 'Ed25519', x: 'attacker_key_456' };

      let errorThrown = false;
      try {
        await authA.trustStore.addPeer('PEER_B', attackerKey, 'Ed25519');
      } catch (e) {
        errorThrown = true;
        this.assert(e.message === 'PUBLIC_KEY_MISMATCH', 'Should throw key mismatch error');
      }

      this.assert(errorThrown, 'Should detect key mismatch');

      authA.destroy();
    });
  }
}

// ============================================================================
// Run Tests
// ============================================================================

export async function runTests() {
  const runner = new TestRunner();
  const success = await runner.runAll();
  return success;
}

// Auto-run if loaded directly
if (typeof window !== 'undefined') {
  window.runReconnectionAuthTests = runTests;
  console.log('💡 Run tests with: runReconnectionAuthTests()');
}
