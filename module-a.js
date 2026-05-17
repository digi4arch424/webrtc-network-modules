/**
 * module-a.js — Control Plane (Always Active)
 * webrtc-network-modules
 *
 * Central state machine for WebRTC networking.
 * Issues connection tasks, receives status reports,
 * and manages the B→C handoff.
 *
 * Fully decoupled from any project's UI — all state changes
 * are reported via callbacks that the project configures.
 *
 * State machine:
 *
 *   IDLE
 *     │ onCallEstablished(pc)
 *     ▼
 *   LOCAL_ATTEMPT (Module B active)
 *     │ success          │ failure / timeout
 *     ▼                  ▼
 *   CONNECTED         RELAY_ATTEMPT (Module C active)
 *                        │ success     │ failure
 *                        ▼             ▼
 *                    CONNECTED       FAILED
 *
 * Usage:
 *
 *   // 1. Configure once (any project)
 *   ModuleA.configure({
 *     onStateChange: (state, mode) => { myUI.updateNetworkMode(state, mode); },
 *     onLog:         (msg, type)   => { myLogger.log(msg, type); },
 *     stunServers:   [...],   // optional, uses Google STUN by default
 *     turnServers:   [...],   // inject your TURN credentials here
 *     providerName:  "Metered.ca",
 *     timeouts:      { local: 8000, relay: 15000 },
 *   });
 *
 *   // 2. After PeerJS call is answered or made:
 *   ModuleA.onCallEstablished(call.peerConnection);
 *
 *   // 3. When stream arrives:
 *   ModuleA.onStreamReceived();
 *
 *   // 4. Get ICE config to pass to PeerJS:
 *   const iceConfig = ModuleA.getIceConfig();
 *   new Peer(id, { config: iceConfig });
 *
 *   // 5. On disconnect:
 *   ModuleA.disconnect();
 */

const ModuleA = (function () {

  const STATE = {
    IDLE:          "idle",
    LOCAL_ATTEMPT: "local_attempt",
    RELAY_ATTEMPT: "relay_attempt",
    CONNECTED:     "connected",
    FAILED:        "failed",
  };

  let _config       = {};
  let _state        = STATE.IDLE;
  let _networkMode  = null;  // "local" | "relay"
  let _pc           = null;

  // ── Configuration ─────────────────────────────────────────────────────────────
  function configure(config) {
    _config = config;

    // Pass relevant config down to B and C
    ModuleB.configure({
      stunServers: config.stunServers,
      timeouts:    config.timeouts,
    });

    ModuleC.configure({
      turnServers:  config.turnServers  || [],
      providerName: config.providerName || "TURN relay",
      timeouts:     config.timeouts,
    });

    _log("Module A: configured" + (ModuleC.isConfigured()
      ? " — TURN via " + (config.providerName || "relay") + " ✓"
      : " — no TURN credentials (cross-network will fail)"), "network");
  }

  // ── State machine ─────────────────────────────────────────────────────────────
  function _setState(newState) {
    const prev = _state;
    _state = newState;
    _log("Module A: " + prev + " → " + newState, "network");
    if (_config.onStateChange) _config.onStateChange(newState, _networkMode);
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Returns the ICE config for the initial PeerJS connection.
   * Always uses Module B config (STUN only) at start.
   * Module C config is applied if relay is needed (future: renegotiation).
   */
  function getIceConfig() {
    return ModuleB.getIceConfig();
  }

  /**
   * Call after a PeerJS call is answered or made.
   * Passes the RTCPeerConnection to begin ICE monitoring.
   */
  function onCallEstablished(pc) {
    _pc = pc;
    _setState(STATE.LOCAL_ATTEMPT);

    // Start Module B
    ModuleB.attempt(
      // B success
      () => {
        _networkMode = "local";
        _setState(STATE.CONNECTED);
        ModuleC.cancel();
      },
      // B failure → try Module C
      (reason) => {
        _log("Module A: Module B failed (" + reason + ") → activating Module C");
        _setState(STATE.RELAY_ATTEMPT);

        ModuleC.attempt(
          // C success
          () => {
            _networkMode = "relay";
            _setState(STATE.CONNECTED);
          },
          // C failure
          (reason) => {
            _setState(STATE.FAILED);
            _log("Module A: all paths failed — no connection possible", "error");
          }
        );
      }
    );

    // Monitor ICE and route events to active module
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      _log("ICE connection state: " + iceState, "ice");
      if (_config.onIceStateChange) _config.onIceStateChange(iceState);

      if (_state === STATE.LOCAL_ATTEMPT) {
        ModuleB.onIceStateChange(iceState);
      } else if (_state === STATE.RELAY_ATTEMPT) {
        ModuleC.onIceStateChange(iceState);
      } else if (_state === STATE.CONNECTED) {
        if (iceState === "disconnected" || iceState === "failed") {
          _log("Module A: connection dropped — resetting", "warn");
          _networkMode = null;
          ModuleB.cancel();
          ModuleC.cancel();
          _setState(STATE.IDLE);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      const connState = pc.connectionState;
      _log("Connection state: " + connState, "network");
      if (_config.onConnectionStateChange) _config.onConnectionStateChange(connState);
    };

    pc.onicegatheringstatechange = () => {
      _log("ICE gathering state: " + pc.iceGatheringState, "ice");
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        _log("ICE candidate: " + e.candidate.type + " / " + e.candidate.protocol, "ice");
        if (e.candidate.type === "relay" && _state === STATE.LOCAL_ATTEMPT) {
          ModuleB.onCandidatePairSelected("relay");
        }
      } else {
        _log("ICE gathering complete", "ice");
      }
    };
  }

  /**
   * Call when local stream is sent (sender side) or remote stream received (viewer side).
   * Treats stream flowing as connection success if module hasn't resolved yet.
   */
  function onStreamReceived() {
    _log("Module A: stream confirmed via " + (_networkMode || "unknown") + " path ✓", "success");

    // Stream flowing = connection successful — resolve whichever module is active
    if (_state === STATE.LOCAL_ATTEMPT) {
      _log("Module A: stream flowing during local attempt — confirming local path ✓", "success");
      ModuleB.onIceStateChange("connected");
    } else if (_state === STATE.RELAY_ATTEMPT) {
      _log("Module A: stream flowing during relay attempt — confirming relay path ✓", "success");
      ModuleC.onIceStateChange("connected");
    }
  }

  // Alias for sender side — same logic
  const onStreamSent = onStreamReceived;

  /**
   * Clean shutdown.
   */
  function disconnect() {
    ModuleB.cancel();
    ModuleC.cancel();
    _pc          = null;
    _networkMode = null;
    _setState(STATE.IDLE);
  }

  function getState()       { return _state; }
  function getNetworkMode() { return _networkMode; }

  function _log(msg, type) {
    if (_config.onLog)       _config.onLog(msg, type);
    else if (window.debugLog) window.debugLog(msg, type || "network");
    else console.log("[ModuleA]", msg);
  }

  return {
    configure,
    getIceConfig,
    onCallEstablished,
    onStreamReceived,
    onStreamSent,
    disconnect,
    getState,
    getNetworkMode,
    STATE,
  };

})();
