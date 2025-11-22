# Playwright E2E Test Suite for Serverless Chat

This directory contains comprehensive end-to-end tests for the serverless P2P mesh chat application using Playwright.

## Overview

The test suite validates all critical features of the P2P mesh chat:
- Multi-browser peer connections (2 and 3 peer meshes)
- Real-time messaging across peers
- Display name management and propagation
- Local peer renaming (custom nicknames)
- Automatic reconnection after page refresh
- localStorage persistence across browser sessions
- Browser close/reopen scenarios

## Prerequisites

- Node.js 18+
- npm or equivalent package manager
- Chromium browser (installed automatically by Playwright)

## Installation

Install Playwright and browser binaries:

```bash
npm install
npx playwright install chromium
```

## Running Tests

### Run all tests (headless)
```bash
npm test
```

### Run tests with visible browser (headed mode)
```bash
npm run test:headed
```

### Run tests in interactive UI mode
```bash
npm run test:ui
```

### Run tests in debug mode
```bash
npm run test:debug
```

### Run specific test file
```bash
npx playwright test tests/e2e/peer-connection.spec.js
```

### Run specific test by name
```bash
npx playwright test --grep "should establish connection between 2 peers"
```

## Test Structure

```
tests/
├── README.md                          # This file
└── e2e/
    ├── peer-connection.spec.js        # Basic peer connection tests (2 and 3 peers)
    ├── chat-messaging.spec.js         # Message sending/receiving tests
    ├── display-name.spec.js           # Display name change and propagation tests
    ├── peer-renaming.spec.js          # Local peer renaming tests
    ├── reconnection.spec.js           # Automatic reconnection after refresh
    ├── persistent-storage.spec.js     # Browser close/reopen persistence tests
    └── utils/
        ├── peer-context.js            # Multi-browser context management
        ├── storage-helpers.js         # localStorage manipulation utilities
        ├── connection-helpers.js      # WebRTC connection utilities
        ├── ui-helpers.js              # UI interaction utilities
        └── wait-helpers.js            # Condition-based wait utilities
```

## Test Details

### Peer Connection Tests
**File:** `peer-connection.spec.js`

- Establishes WebRTC connections between 2 peers
- Creates full mesh topology with 3 peers (automatic peer introduction)
- Validates peer information in UI (UUIDs, display names)
- Tests connection quality indicators

### Chat Messaging Tests
**File:** `chat-messaging.spec.js`

- Validates message input enablement after connection
- Tests bidirectional messaging between 2 peers
- Validates message broadcasting to all peers in mesh (3+ peers)
- Tests message routing and deduplication

### Display Name Tests
**File:** `display-name.spec.js`

- Tests auto-generated display names
- Validates display name changes via UI
- Tests name change propagation to all connected peers
- Validates name persistence across page reloads

### Peer Renaming Tests
**File:** `peer-renaming.spec.js`

- Tests local peer renaming (custom nicknames)
- Validates that renames are local-only (not shared with network)
- Tests rename persistence in localStorage
- Validates rename preservation after page reload
- Tests clearing custom names

### Reconnection Tests
**File:** `reconnection.spec.js`

- Tests peer data persistence to localStorage
- Validates automatic reconnection after page refresh
- Tests message exchange after reconnection
- Validates reconnection to mesh when other peers stay connected
- Tests multiple sequential refreshes

### Persistent Storage Tests
**File:** `persistent-storage.spec.js`

- Tests data persistence across browser close/reopen
- Validates reconnection after both peers restart
- Tests display name preservation after browser restart
- Uses Playwright storage state API

## Key Testing Patterns

### Multi-Browser Coordination

Tests spawn multiple browser contexts to simulate different users:

```javascript
const peerContexts = await createPeerContexts(browser, 3);
const [peer1, peer2, peer3] = peerContexts;

// Navigate all peers in parallel
await Promise.all([
  peer1.goto('/'),
  peer2.goto('/'),
  peer3.goto('/')
]);
```

### Manual Peer Connection

WebRTC signaling coordination for establishing connections:

```javascript
await manualPeerConnection(peer1.page, peer2.page);
```

This automates the offer/answer exchange that users would normally do manually.

### Condition-Based Waiting

The test suite uses intelligent condition-based waits instead of fixed timeouts for faster and more reliable tests:

```javascript
import {
  waitForMeshReady,
  waitForPeerPersisted,
  waitForReconnectionComplete
} from './utils/wait-helpers.js';

// Wait for mesh to be ready (faster than fixed timeout)
await waitForMeshReady(page, 2);

// Wait for peer data persistence before reload
await waitForPeerPersisted(page, peerId);

// Wait for full reconnection cycle
await waitForReconnectionComplete(page, 1);
```

**Benefits over fixed timeouts:**
- **3-10x faster**: Conditions resolve immediately when met
- **More reliable**: Waits for actual conditions, not arbitrary time
- **Better errors**: Clear messages explain what condition failed
- **Stability checks**: Prevents flaky tests from transient states

**Available helpers:**
- `waitForCondition()` - Generic condition-based wait
- `waitForStableConnection()` - Wait for connection to stabilize
- `waitForPeerPersisted()` - Wait for localStorage persistence
- `waitForMeshReady()` - Wait for mesh to form with all peers connected
- `waitForMeshTopologyStable()` - Wait for mesh topology to stabilize
- `waitForConnectionState()` - Wait for specific connection state
- `waitForReconnectionComplete()` - Wait for full reconnection cycle
- `waitForPageStable()` - Wait for DOM mutations to stop
- `waitForElementStable()` - Wait for element to appear and stabilize
- `waitForDisplayNamePropagation()` - Wait for name change to propagate
- `waitForEditDialogReady()` - Wait for edit dialog to be ready

See `utils/wait-helpers.js` for complete documentation.

### localStorage Persistence

Saving and restoring browser state:

```javascript
await peer1Context.saveStorageState(storagePath);

// Later: restore state
await peer1Context.initialize({ storageState: storagePath });
```

## Configuration

Playwright configuration is in `playwright.config.js`:

- **Base URL:** `http://localhost:3000/serverless-chat/`
- **Test timeout:** 60 seconds (P2P connections can be slow)
- **Workers:** 1 (tests cannot run in parallel due to port conflicts)
- **Retries:** 2 in CI, 0 locally
- **Dev server:** Automatically started before tests

## Timeouts

P2P/WebRTC tests require generous timeouts:

- **Page load:** Uses `domcontentloaded` (faster than `networkidle`)
- **Peer connection:** 30 seconds
- **Mesh formation (3+ peers):** 35 seconds (includes automatic introduction)
- **Reconnection:** 40-45 seconds (may use multiple fallback strategies)
- **Message delivery:** 10-15 seconds

## Test Artifacts

Test runs generate artifacts in `test-results/`:

- Screenshots on failure
- Videos on failure
- Error context files
- HTML test report

View the HTML report:

```bash
npx playwright show-report
```

## Debugging Tests

### Debug a specific test
```bash
npx playwright test --debug --grep "test name"
```

### View test traces
```bash
npx playwright show-trace test-results/[test-folder]/trace.zip
```

### Inspect element selectors
```bash
npx playwright codegen http://localhost:3000/serverless-chat/
```

## Common Issues

### Test timeout
- Increase timeout in test or config
- Check network conditions
- Verify WebRTC/STUN servers are accessible

### Port already in use
- Kill existing dev server: `lsof -ti:3000 | xargs kill -9`
- Tests start dev server automatically

### Browser context errors
- Ensure proper cleanup in afterEach hooks
- Check that `.temp/` directory is writable

### Flaky tests
- P2P connections are inherently variable
- Tests include appropriate waits and retries
- Run with `--retries 2` for flaky tests

## CI/CD Integration

Example GitHub Actions workflow:

```yaml
name: E2E Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm test
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Contributing

When adding new tests:

1. Follow existing test patterns
2. Use utility functions from `utils/` directory
3. Add appropriate timeouts for P2P operations
4. Clean up browser contexts in `afterEach`
5. Document any new test scenarios in this README

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [WebRTC Testing Guide](https://playwright.dev/docs/network#websockets)
- [Project Architecture](../CLAUDE.md)
