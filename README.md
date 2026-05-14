# webrtc-network-modules

Reusable WebRTC networking modules for browser-based streaming applications.
Three modules handle signaling, local P2P, and cross-network TURN relay automatically.

No build system. No dependencies. Pure vanilla JS — drop into any project.

---

## Architecture

```
Module A — Control Plane (always active)
    │
    ├── Module B — Local Network Media Path (STUN / P2P)
    │       │ success → Connected (Local P2P)
    │       │ failure ↓
    └── Module C — Cross-Network Reliability Layer (TURN relay)
            │ success → Connected (Relay)
            │ failure → Failed
```

**Module A** is the state machine. It issues tasks to B and C, receives their results, and manages the handoff. Your app only talks to Module A.

**Module B** attempts a direct P2P connection using STUN. Fast, free, works on same network.

**Module C** activates only if B fails. Uses TURN relay to traverse NAT and firewalls. Requires TURN credentials.

---

## Usage

### 1. Load scripts in order

```html
<script src="module-b.js"></script>
<script src="module-c.js"></script>
<script src="module-a.js"></script>
```

### 2. Configure once (before any calls)

```js
ModuleA.configure({
  // Called on every state change — update your own UI here
  onStateChange: (state, mode) => {
    console.log("Network state:", state, "via:", mode);
    myUI.setNetworkMode(state === "connected" ? mode : state);
  },

  // TURN credentials — inject from your provider
  // Leave empty to use STUN only (same-network streaming only)
  turnServers: [
    { urls: "stun:standard.relay.metered.ca:80" },
    { urls: "turn:standard.relay.metered.ca:80", username: "YOUR_USER", credential: "YOUR_PASS" },
    { urls: "turn:standard.relay.metered.ca:80?transport=tcp", username: "YOUR_USER", credential: "YOUR_PASS" },
    { urls: "turn:standard.relay.metered.ca:443", username: "YOUR_USER", credential: "YOUR_PASS" },
    { urls: "turns:standard.relay.metered.ca:443?transport=tcp", username: "YOUR_USER", credential: "YOUR_PASS" },
  ],
  providerName: "Metered.ca",

  // Optional: custom timeouts (ms)
  timeouts: { local: 8000, relay: 15000 },

  // Optional: custom STUN servers
  stunServers: [
    { urls: "stun:stun.l.google.com:19302" },
  ],
});
```

### 3. Get ICE config for PeerJS

```js
const peer = new Peer(myId, {
  host: "your-signaling-server.onrender.com",
  port: 443,
  path: "/",
  secure: true,
  config: ModuleA.getIceConfig(),
});
```

### 4. After call is established

```js
// After peer.call() or call.answer()
ModuleA.onCallEstablished(call.peerConnection);
```

### 5. When stream arrives

```js
call.on("stream", (remoteStream) => {
  ModuleA.onStreamReceived();
  // display stream...
});
```

### 6. On disconnect

```js
ModuleA.disconnect();
```

---

## State Reference

| State | Meaning |
|---|---|
| `idle` | No active connection |
| `local_attempt` | Module B trying P2P |
| `relay_attempt` | Module B failed, Module C trying TURN |
| `connected` | Media flowing — check `getNetworkMode()` for path |
| `failed` | All paths failed |

```js
ModuleA.getState();       // current state string
ModuleA.getNetworkMode(); // "local" | "relay" | null
```

---

## TURN Providers

| Provider | Free Tier | Notes |
|---|---|---|
| [Metered.ca](https://dashboard.metered.ca) | 500MB/month | Recommended — reliable, no CC required |
| [Twilio](https://www.twilio.com/stun-turn) | Pay as you go | Enterprise grade |
| [Xirsys](https://xirsys.com) | Free tier available | Good for production |
| Self-hosted (coturn) | Free | Full control, requires VPS |

---

## Projects Using This

- [site-eye-webRTC](https://github.com/digi4arch424/site-eye-webRTC) — Construction Camera System

---

## Milestones

These modules grow with the construction cam project:

| Milestone | Network change |
|---|---|
| M1 ✅ | Core B→C handoff, PeerJS signaling |
| M2 | GPS metadata via Module A data channel |
| M5 | Multiset VPS — Module A coordinates position stream |
| M7 | Multi-camera — Module A manages multiple peer sessions |
