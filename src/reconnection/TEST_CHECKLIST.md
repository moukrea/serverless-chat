# ReconnectionManager Test Checklist

## Unit Tests

Run the test suite:
```bash
npm test src/reconnection/relay-reconnection.test.js
```

### Test Coverage
- [x] Initialization
- [x] Path Discovery
- [x] Reconnection Flow
- [x] Acceptance Logic
- [x] Message Handling
- [x] Statistics
- [x] State Management
- [x] Cleanup

## Manual Testing

### Setup
1. Open 3 browser tabs (Peer A, B, C)
2. Connect A ↔ B ↔ C
3. Open browser console in each tab

### Test 1: Basic Reconnection
**Goal**: Verify basic reconnection works

1. [ ] Disconnect Peer A from B
2. [ ] Wait 5 seconds
3. [ ] Verify automatic reconnection attempts
4. [ ] Verify A reconnects to B via C
5. [ ] Check statistics: `reconnectionManager.getStats()`

**Expected**:
- Path query sent and answered
- Offer/answer exchange
- Connection established in 10-25 seconds
- Success rate > 0%

### Test 2: Path Discovery
**Goal**: Verify path finding works

1. [ ] In Peer A console, run:
   ```javascript
   await reconnectionManager.findPathToTarget('peer-B-id', 5000)
   ```
2. [ ] Should return `true` if B is reachable via mesh
3. [ ] Disconnect all paths to B
4. [ ] Run again, should return `false`

**Expected**:
- `true` when path exists
- `false` when no path
- Query completes within 5 seconds

### Test 3: Deterministic Tie-Breaking
**Goal**: Verify no duplicate connections

1. [ ] Disconnect Peer A from B
2. [ ] In A console: `reconnectViaMesh('peer-B-id', 'B')`
3. [ ] In B console: `reconnectViaMesh('peer-A-id', 'A')`
4. [ ] Both attempt simultaneously
5. [ ] Verify only ONE connection is established

**Expected**:
- One peer initiates, other rejects
- Only one connection created
- Rejection reason: tie-breaking

### Test 4: Connection Limits
**Goal**: Verify connection limits are respected

1. [ ] Set low limit: `peerManager.maxConnections = 2`
2. [ ] Connect to 2 peers
3. [ ] Attempt reconnection to 3rd peer
4. [ ] Verify rejection

**Expected**:
- Rejection with reason: "at max connections"
- No new connection created

### Test 5: No Path Found
**Goal**: Verify graceful failure when no path

1. [ ] Disconnect all peers from A
2. [ ] Attempt reconnection
3. [ ] Verify failure after 5 seconds

**Expected**:
- Path query times out
- Result: `{ success: false, reason: 'no_path_found' }`
- Failed attempt recorded

### Test 6: Message Routing
**Goal**: Verify messages route correctly

1. [ ] In any peer console:
   ```javascript
   // Monitor all reconnection messages
   for (const type of ['path_query', 'path_response', 'reconnect_offer', 'reconnect_answer']) {
     router.on(type, msg => console.log(`[${type}]`, msg));
   }
   ```
2. [ ] Attempt reconnection
3. [ ] Observe message flow

**Expected**:
- PATH_QUERY broadcasts
- PATH_RESPONSE from connected peers
- RECONNECT_OFFER to target
- RECONNECT_ANSWER back to initiator

### Test 7: Statistics Tracking
**Goal**: Verify statistics are accurate

1. [ ] Check initial stats:
   ```javascript
   reconnectionManager.getStats()
   ```
2. [ ] Attempt 3 reconnections (1 success, 2 failures)
3. [ ] Check stats again
4. [ ] Verify counts are correct

**Expected**:
```javascript
{
  totalAttempts: 3,
  successful: 1,
  failed: 2,
  successRate: '33.3%',
  // ...
}
```

### Test 8: State Cleanup
**Goal**: Verify cleanup works

1. [ ] Check current state:
   ```javascript
   reconnectionManager.getState()
   ```
2. [ ] Start reconnection
3. [ ] Immediately check state (should have pending)
4. [ ] Wait for completion
5. [ ] Check state again (should be clean)

**Expected**:
- Pending reconnections during attempt
- Clean state after completion/timeout
- No memory leaks

### Test 9: Concurrent Reconnections
**Goal**: Verify concurrent limit works

1. [ ] Attempt 6 simultaneous reconnections
2. [ ] Verify max 5 are pending
3. [ ] 6th attempt rejects immediately

**Expected**:
- Max 5 pending at once
- Result: `{ success: false, reason: 'too_many_concurrent_attempts' }`

### Test 10: Error Recovery
**Goal**: Verify error handling

1. [ ] Cause various errors:
   - Invalid peer ID
   - Network disconnection
   - Peer rejection
   - Timeout
2. [ ] Verify graceful handling
3. [ ] Verify cleanup occurs

**Expected**:
- No crashes
- Proper error reasons returned
- State cleaned up
- Statistics updated

## Integration Testing

### Test 11: Auto-Reconnection
**Goal**: Verify automatic reconnection on disconnect

1. [ ] Enable auto-reconnection
2. [ ] Disconnect a peer
3. [ ] Verify automatic attempt after delay
4. [ ] Verify UI updates

### Test 12: Manual Reconnection UI
**Goal**: Verify UI integration

1. [ ] View disconnected peers list
2. [ ] Click reconnect button
3. [ ] Verify button states update
4. [ ] Verify peer list updates

### Test 13: Retry with Backoff
**Goal**: Verify retry logic

1. [ ] Implement retry logic
2. [ ] Cause initial failure
3. [ ] Verify exponential backoff
4. [ ] Verify max retries respected

## Performance Testing

### Test 14: Speed
**Goal**: Verify target speed (10-25 seconds)

1. [ ] Measure reconnection time
2. [ ] Average over 10 attempts
3. [ ] Verify within target range

### Test 15: Success Rate
**Goal**: Verify target success rate (70-80%)

1. [ ] Attempt 20 reconnections
2. [ ] Track success/failure
3. [ ] Calculate rate
4. [ ] Verify within target range

### Test 16: Resource Usage
**Goal**: Verify no memory leaks

1. [ ] Monitor memory usage
2. [ ] Perform 50 reconnections
3. [ ] Verify memory stabilizes
4. [ ] Check cleanup occurs

## Network Conditions

### Test 17: Different Network Topologies
- [ ] Star topology (all connect to hub)
- [ ] Mesh topology (all connect to all)
- [ ] Chain topology (A-B-C-D)
- [ ] Isolated islands (no path)

### Test 18: High Latency
- [ ] Simulate 500ms latency
- [ ] Verify still succeeds
- [ ] May take longer but works

### Test 19: Packet Loss
- [ ] Simulate 10% packet loss
- [ ] Verify retries work
- [ ] Verify eventual success

### Test 20: Firewall/NAT
- [ ] Test with restrictive NAT
- [ ] Verify TURN fallback
- [ ] Verify relay signaling works

## Browser Compatibility

### Test 21: Cross-Browser
- [ ] Chrome
- [ ] Firefox
- [ ] Safari
- [ ] Edge

### Test 22: Mobile
- [ ] Mobile Chrome
- [ ] Mobile Safari
- [ ] Connection stability

## Edge Cases

### Test 23: Simultaneous Disconnects
- [ ] All peers disconnect at once
- [ ] Verify recovery when some return

### Test 24: Rapid Connect/Disconnect
- [ ] Connect/disconnect rapidly
- [ ] Verify state consistency
- [ ] No race conditions

### Test 25: Page Refresh
- [ ] Refresh during reconnection
- [ ] Verify cleanup occurs
- [ ] Verify persistence works

## Debugging

### Enable Verbose Logging
```javascript
// Filter console to reconnection logs
console.log = (function(log) {
  return function(...args) {
    if (args[0] && args[0].includes('[ReconnectionManager]')) {
      log.apply(console, args);
    }
  };
})(console.log);
```

### Monitor State
```javascript
// Check state every second
setInterval(() => {
  const state = reconnectionManager.getState();
  console.log('Pending:', state.pendingReconnects.length);
  console.log('Queries:', state.activeQueries.length);
}, 1000);
```

### Track Messages
```javascript
// Log all reconnection messages
const types = [
  'path_query',
  'path_response',
  'reconnect_offer',
  'reconnect_answer',
  'reconnect_rejection'
];

for (const type of types) {
  router.on(type, msg => {
    console.log(`[${type}]`, msg.payload);
  });
}
```

## Success Criteria

### Must Pass
- [x] Unit tests: 25/25 passing
- [ ] Manual tests: 15/15 passing
- [ ] Integration tests: 3/3 passing
- [ ] Performance tests: 3/3 passing

### Target Metrics
- [ ] Success rate: 70-80%
- [ ] Average time: 10-25 seconds
- [ ] No memory leaks
- [ ] No crashes

## Final Verification

Before shipping:
1. [ ] All tests pass
2. [ ] Documentation complete
3. [ ] Examples work
4. [ ] Performance acceptable
5. [ ] No console errors
6. [ ] Statistics accurate
7. [ ] Cleanup working
8. [ ] Integration smooth

---

**Testing Status**: Ready for testing
**Last Updated**: 2024-11-21
