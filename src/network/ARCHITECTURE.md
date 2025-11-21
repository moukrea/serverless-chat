# Network Change Detector - Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser Environment                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐ │
│  │ navigator.onLine │    │navigator.connect.│    │    WebRTC    │ │
│  │   (all browsers) │    │   (Chrome/Edge)  │    │   + STUN     │ │
│  └────────┬─────────┘    └────────┬─────────┘    └──────┬───────┘ │
│           │                       │                      │         │
│           │ online/offline        │ connection           │ ICE     │
│           │ events                │ change               │ cands   │
│           ▼                       ▼                      ▼         │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │          NetworkChangeDetector                             │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │ Event Listeners                                      │  │   │
│  │  │  • online → handleOnline()                          │  │   │
│  │  │  • offline → handleOffline()                        │  │   │
│  │  │  • connection.change → handleNetworkChange()        │  │   │
│  │  │  • periodic (2min) → checkPublicIP()                │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                          │                                 │   │
│  │                          ▼                                 │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │ IP Detection (STUN)                                  │  │   │
│  │  │  1. Create RTCPeerConnection                        │  │   │
│  │  │  2. Add STUN servers                                │  │   │
│  │  │  3. Trigger ICE gathering                           │  │   │
│  │  │  4. Extract public IP from srflx candidates         │  │   │
│  │  │  5. Filter out private IPs                          │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                          │                                 │   │
│  │                          ▼                                 │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │ Change Detection                                     │  │   │
│  │  │  • Compare with localStorage                        │  │   │
│  │  │  • Detect IP changes                                │  │   │
│  │  │  • Track connection type changes                    │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  │                          │                                 │   │
│  │                          ▼                                 │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │ Statistics & State                                   │  │   │
│  │  │  • ipChangeCount                                    │  │   │
│  │  │  • connectionTypeChangeCount                        │  │   │
│  │  │  • onlineCount / offlineCount                       │  │   │
│  │  │  • timestamps                                       │  │   │
│  │  └─────────────────────────────────────────────────────┘  │   │
│  └───────────────────────────┬────────────────────────────────┘   │
│                              │                                     │
└──────────────────────────────┼─────────────────────────────────────┘
                               │
                               │ IP changed!
                               ▼
                 ┌──────────────────────────────┐
                 │   reconnector.handleIpChange()│
                 └──────────────┬───────────────┘
                                │
                                ▼
             ┌──────────────────────────────────────┐
             │   MeshAnnouncementManager            │
             │   .announceIpChange()                │
             └──────────────┬───────────────────────┘
                            │
                            ▼
             ┌──────────────────────────────────────┐
             │   Create signed announcement         │
             │   • peerId                           │
             │   • displayName                      │
             │   • timestamp                        │
             │   • cryptographic signature          │
             │   • connection hints                 │
             └──────────────┬───────────────────────┘
                            │
                            ▼
             ┌──────────────────────────────────────┐
             │   Broadcast via Flood Routing        │
             │   (TTL: 10, higher priority)         │
             └──────────────┬───────────────────────┘
                            │
                            ▼
             ┌──────────────────────────────────────┐
             │   All mesh peers receive             │
             │   announcement & attempt reconnect   │
             └──────────────────────────────────────┘
```

## Event Flow Diagrams

### 1. Connection Type Change (WiFi → Cellular)

```
User switches from WiFi to Cellular
              ▼
    navigator.connection.change event
              ▼
    connectionChangeListener()
              ▼
    Debounce (1 second)
              ▼
    handleNetworkChange()
              ▼
    Detect type change: wifi → cellular
              ▼
    Update stats (connectionTypeChangeCount++)
              ▼
    Wait 2 seconds (network stabilization)
              ▼
    checkPublicIP()
              ▼
    Get IP via STUN
              ▼
    Compare with localStorage
              ▼
    ┌────────────────┐
    │ IP changed?    │
    └───┬────────┬───┘
        │        │
      YES       NO
        │        │
        ▼        ▼
    Announce  Log "unchanged"
```

### 2. Online/Offline Cycle

```
Network disconnects
        ▼
    window 'offline' event
        ▼
    handleOffline()
        ▼
    offlineCount++
    lastOfflineTime = now
        ▼
    Log offline
        ▼
    [User reconnects to network]
        ▼
    window 'online' event
        ▼
    handleOnline()
        ▼
    onlineCount++
    lastOnlineTime = now
    Calculate offline duration
        ▼
    Wait 2 seconds
        ▼
    checkPublicIP()
        ▼
    Likely IP changed → Announce
```

### 3. Periodic IP Check

```
Every 2 minutes
      ▼
setInterval() fires
      ▼
checkPublicIP()
      ▼
┌─────────────────────┐
│ Create temp         │
│ RTCPeerConnection   │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ Add STUN servers:   │
│ • Google STUN 1     │
│ • Google STUN 2     │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ createDataChannel() │
│ createOffer()       │
│ setLocalDesc()      │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ ICE gathering       │
│ starts              │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ Wait for candidates │
│ (max 5 seconds)     │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ Extract IP from     │
│ srflx candidate     │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ Filter private IPs: │
│ • 192.168.x.x       │
│ • 10.x.x.x          │
│ • 172.16-31.x.x     │
└─────────┬───────────┘
          ▼
    Return public IP
          ▼
┌─────────────────────┐
│ Compare with stored │
└─────────┬───────────┘
          ▼
    If changed:
    • Store new IP
    • ipChangeCount++
    • reconnector.handleIpChange()
```

## State Transitions

### Connection Type States

```
┌─────────┐
│ Unknown │ (initial state or API unavailable)
└────┬────┘
     │ Network Info API available
     ▼
┌─────────┐    change event    ┌──────────┐
│  WiFi   │◄──────────────────►│ Cellular │
└─────────┘                    └──────────┘
     │                              │
     │ change event                 │ change event
     ▼                              ▼
┌─────────┐                    ┌──────────┐
│Ethernet │                    │   4G     │
└─────────┘                    └──────────┘
```

### Online/Offline States

```
┌────────┐    'offline' event    ┌─────────┐
│ Online │───────────────────────►│ Offline │
└────┬───┘                        └────┬────┘
     │         'online' event          │
     │◄────────────────────────────────┘
     │
     │ While online:
     │ • checkPublicIP() every 2min
     │ • monitor connection changes
     │
     └──► Continuous monitoring
```

### IP Address States

```
┌──────────────┐
│ No known IP  │ (first run)
└──────┬───────┘
       │ getPublicIP() → 203.0.113.42
       ▼
┌──────────────┐
│ Stored in    │
│ localStorage │
└──────┬───────┘
       │
       │ Periodic checks
       ▼
┌──────────────┐
│ IP unchanged │◄────┐
└──────┬───────┘     │
       │             │
       │ Network     │ Same IP
       │ change      │
       ▼             │
┌──────────────┐     │
│ getPublicIP()├─────┘
└──────┬───────┘
       │ Different IP
       ▼
┌──────────────┐
│ IP changed!  │
│ Announce     │
└──────────────┘
```

## Data Flow

### Input Data

```
Browser APIs → NetworkChangeDetector
  │
  ├─► navigator.onLine (boolean)
  ├─► navigator.connection.effectiveType (string)
  ├─► navigator.connection.type (string)
  ├─► navigator.connection.downlink (number, Mbps)
  ├─► navigator.connection.rtt (number, ms)
  ├─► WebRTC ICE candidates (array)
  └─► localStorage.lastKnownPublicIP (string)
```

### Internal Processing

```
NetworkChangeDetector Internal State
  │
  ├─► Statistics
  │   ├─► ipChangeCount (number)
  │   ├─► connectionTypeChangeCount (number)
  │   ├─► onlineCount (number)
  │   └─► offlineCount (number)
  │
  ├─► Timestamps
  │   ├─► lastIpChangeTime (timestamp)
  │   ├─► lastOnlineTime (timestamp)
  │   ├─► lastOfflineTime (timestamp)
  │   └─► startTime (timestamp)
  │
  └─► Current State
      ├─► lastConnectionType (string)
      ├─► lastKnownIP (string)
      └─► feature flags (object)
```

### Output Data

```
NetworkChangeDetector → Application
  │
  ├─► reconnector.handleIpChange() (trigger)
  │
  ├─► getStats() → {
  │     isOnline, currentConnectionType,
  │     lastKnownIP, counters, timestamps,
  │     durations, features
  │   }
  │
  └─► getStatusSummary() → string
```

## Component Interactions

```
┌────────────────────────────────────────────────────────────┐
│                     Application Layer                      │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────┐        ┌──────────────────────────┐     │
│  │   App.jsx    │───────►│ setupNetworkMonitoring() │     │
│  └──────────────┘        └────────┬─────────────────┘     │
│                                   │                        │
└───────────────────────────────────┼────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────┐
│                   Integration Layer                        │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐      ┌──────────────────────┐   │
│  │ ReconnectorAdapter   │◄─────┤ NetworkChange        │   │
│  │ • handleIpChange()   │      │ Detector             │   │
│  └──────────┬───────────┘      └──────────────────────┘   │
│             │                                              │
└─────────────┼──────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────┐
│                  Reconnection Layer                        │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐ │
│  │  MeshAnnouncementManager                             │ │
│  │  • announceIpChange()                                │ │
│  │  • createAnnouncement()                              │ │
│  └────────────────────┬─────────────────────────────────┘ │
│                       │                                    │
└───────────────────────┼────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────┐
│                    Mesh Network Layer                      │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────┐     ┌──────────────┐   ┌────────────┐  │
│  │ MessageRouter│────►│FloodRouting  │──►│ All Peers  │  │
│  └──────────────┘     └──────────────┘   └────────────┘  │
└────────────────────────────────────────────────────────────┘
```

## Timing Diagram

```
Time  │ Event                          │ Action
──────┼────────────────────────────────┼──────────────────────────
 0s   │ App starts                     │ Initialize detector
 1s   │                                │ Setup listeners
 2s   │                                │ Initial IP check
 4s   │ Initial IP: 203.0.113.42       │ Store in localStorage
──────┼────────────────────────────────┼──────────────────────────
120s  │ Periodic check                 │ Check IP via STUN
124s  │ IP unchanged                   │ Log, no action
──────┼────────────────────────────────┼──────────────────────────
180s  │ User switches WiFi→Cellular    │ connection.change event
180s  │                                │ Debounce (1s)
181s  │ Type change detected           │ connectionTypeChangeCount++
183s  │ Network stabilized             │ Check IP via STUN
188s  │ IP changed: ...42 → ...99      │ ipChangeCount++
188s  │                                │ reconnector.handleIpChange()
189s  │ Announcement created           │ Sign with private key
189s  │ Broadcast to mesh              │ Flood routing (TTL: 10)
190s  │ Peers receive                  │ Begin reconnection
──────┼────────────────────────────────┼──────────────────────────
240s  │ Periodic check                 │ Check IP via STUN
244s  │ IP unchanged: ...99            │ Log, no action
──────┼────────────────────────────────┼──────────────────────────
```

## Error Handling Flow

```
Try: getPublicIP()
  │
  ├─► RTCPeerConnection creation fails
  │   └─► Catch → Log error → Return null
  │
  ├─► STUN server unreachable
  │   └─► Timeout (5s) → Return null
  │
  └─► ICE gathering fails
      └─► Return null

Try: handleIpChange()
  │
  ├─► reconnector missing
  │   └─► Warn → Continue monitoring
  │
  ├─► reconnector.handleIpChange throws
  │   └─► Catch → Log error → Continue monitoring
  │
  └─► Announcement fails
      └─► Logged by MeshAnnouncementManager

Graceful Degradation:
  │
  ├─► No Network Info API
  │   └─► Return 'unknown' for type
  │   └─► Still monitor online/offline
  │   └─► Still check IP changes
  │
  └─► No WebRTC
      └─► Disable IP checking
      └─► Still monitor connection type
      └─► Still monitor online/offline
```

## Scalability Considerations

### Memory Usage

```
NetworkChangeDetector instance: ~1 KB
  ├─► Statistics counters: ~100 bytes
  ├─► Timestamps: ~64 bytes
  ├─► Event listeners: ~500 bytes
  └─► Feature flags: ~100 bytes

localStorage: ~50 bytes
  └─► lastKnownPublicIP: "203.0.113.42"

Total: ~1 KB per instance
```

### Network Overhead

```
Per periodic check (2 minutes):
  ├─► STUN request: ~200 bytes
  ├─► STUN response: ~500 bytes
  └─► Total: ~700 bytes

Per IP change:
  ├─► STUN check: ~700 bytes
  ├─► Announcement: ~1-2 KB
  └─► Total: ~2-3 KB

Daily network usage (stable network):
  ├─► 720 checks × 700 bytes
  └─► Total: ~500 KB/day
```

### CPU Usage

```
Idle: <0.1% CPU
  └─► Only event listeners active

Periodic check: ~1-5% CPU for 1-2 seconds
  ├─► RTCPeerConnection creation
  ├─► ICE gathering
  └─► IP extraction

Peak during network change: ~5-10% CPU for 2-3 seconds
  ├─► IP check
  ├─► Announcement creation
  └─► Signature generation
```

## Security Considerations

### IP Privacy

```
Public IP is:
  ✅ Stored only in localStorage (browser-local)
  ✅ Never sent to external servers
  ✅ Only used for change detection
  ❌ Shared with mesh peers via announcements
     (but peers already know it from WebRTC)
```

### STUN Server Trust

```
STUN servers can see:
  ✅ Your public IP (already visible to internet)
  ✅ ICE gathering requests
  ❌ Cannot see: application data, messages, keys
  ❌ Cannot see: mesh topology, peer connections
```

### Attack Vectors

```
Mitigations:
  ✅ No user input → No injection attacks
  ✅ No remote code execution
  ✅ No sensitive data storage
  ✅ Graceful failure on errors
  ✅ Announcements are cryptographically signed
```

## See Also

- [NetworkChangeDetector Implementation](./change-detector.js)
- [Integration Examples](./integration-example.js)
- [Test Suite](./change-detector.test.js)
- [User Documentation](./README.md)
