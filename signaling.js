/**
 * signaling.js — WebRTC Signaling Client Module
 * webrtc-network-modules
 *
 * Manages WebSocket connection to the signaling server.
 * Handles registration, SDP relay, ICE relay, and reconnection.
 *
 * Works with webrtc-signaling-server — pure WebRTC API, no PeerJS.
 *
 * Usage:
 *
 *   SignalingClient.configure({
 *     url:       "wss://your-server.onrender.com",
 *     sessionId: "site-cam-001",
 *     role:      "sender" | "viewer",
 *     onRegistered:   ()        => {},  // connected and registered
 *     onOffer:        (sdp)     => {},  // received SDP offer (viewer only)
 *     onAnswer:       (sdp)     => {},  // received SDP answer (sender only)
 *     onIceCandidate: (cand)    => {},  // received ICE candidate
 *     onSenderReady:  ()        => {},  // sender came online (viewer only)
 *     onViewerReady:  ()        => {},  // viewer connected (sender only)
 *     onSenderLeft:   ()        => {},  // sender disconnected (viewer only)
 *     onViewerLeft:   ()        => {},  // viewer disconnected (sender only)
 *     onDisconnected: ()        => {},  // WebSocket closed
 *     onError:        (msg)     => {},  // error message
 *   });
 *
 *   SignalingClient.connect();
 *   SignalingClient.sendOffer(sdp);
 *   SignalingClient.sendAnswer(sdp);
 *   SignalingClient.sendIceCandidate(candidate);
 *   SignalingClient.disconnect();
 */

const SignalingClient = (function () {

  let _config        = {};
  let _ws            = null;
  let _connected     = false;
  let _retryTimer    = null;
  let _retryDelay    = 2000;
  const MAX_DELAY    = 30000;

  // ── Configuration ─────────────────────────────────────────────────────────────
  function configure(config) {
    _config = config;
  }

  // ── Connect ───────────────────────────────────────────────────────────────────
  function connect() {
    if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;

    _log("Signaling: connecting to " + _config.url);

    try {
      _ws = new WebSocket(_config.url);
    } catch (e) {
      _log("Signaling: WebSocket creation failed — " + e.message, "error");
      _scheduleReconnect();
      return;
    }

    _ws.onopen = () => {
      _log("Signaling: connected ✓");
      _connected  = true;
      _retryDelay = 2000;

      // Register immediately on connect
      _send({
        type:      "register",
        sessionId: _config.sessionId,
        role:      _config.role,
      });
    };

    _ws.onmessage = ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); }
      catch { _log("Signaling: invalid JSON received", "warn"); return; }

      _log("Signaling: received → " + msg.type);

      switch (msg.type) {
        case "registered":
          _log("Signaling: registered as " + _config.role + " on session " + msg.sessionId, "success");
          if (_config.onRegistered) _config.onRegistered();
          break;

        case "offer":
          if (_config.onOffer) _config.onOffer(msg.payload);
          break;

        case "answer":
          if (_config.onAnswer) _config.onAnswer(msg.payload);
          break;

        case "ice-candidate":
          if (_config.onIceCandidate) _config.onIceCandidate(msg.payload);
          break;

        case "sender-ready":
          _log("Signaling: sender is online");
          if (_config.onSenderReady) _config.onSenderReady();
          break;

        case "viewer-ready":
          _log("Signaling: viewer connected");
          if (_config.onViewerReady) _config.onViewerReady();
          break;

        case "sender-left":
          _log("Signaling: sender disconnected", "warn");
          if (_config.onSenderLeft) _config.onSenderLeft();
          break;

        case "viewer-left":
          _log("Signaling: viewer disconnected", "warn");
          if (_config.onViewerLeft) _config.onViewerLeft();
          break;

        case "error":
          _log("Signaling: server error — " + msg.payload?.message, "error");
          if (_config.onError) _config.onError(msg.payload?.message);
          break;

        default:
          _log("Signaling: unknown message type — " + msg.type, "warn");
      }
    };

    _ws.onclose = () => {
      _log("Signaling: disconnected", "warn");
      _connected = false;
      if (_config.onDisconnected) _config.onDisconnected();
      _scheduleReconnect();
    };

    _ws.onerror = (e) => {
      _log("Signaling: WebSocket error", "error");
    };
  }

  // ── Send helpers ──────────────────────────────────────────────────────────────
  function _send(msg) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) {
      _log("Signaling: cannot send — not connected", "warn");
      return;
    }
    _ws.send(JSON.stringify({
      ...msg,
      sessionId: _config.sessionId,
      role:      _config.role,
      timestamp: Date.now(),
    }));
  }

  function sendOffer(sdp) {
    _log("Signaling: sending offer");
    _send({ type: "offer", payload: sdp });
  }

  function sendAnswer(sdp) {
    _log("Signaling: sending answer");
    _send({ type: "answer", payload: sdp });
  }

  function sendIceCandidate(candidate) {
    _send({ type: "ice-candidate", payload: candidate });
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────────
  function _scheduleReconnect() {
    clearTimeout(_retryTimer);
    _log("Signaling: reconnecting in " + _retryDelay + "ms");
    _retryTimer = setTimeout(() => {
      _retryDelay = Math.min(_retryDelay * 1.5, MAX_DELAY);
      connect();
    }, _retryDelay);
  }

  // ── Disconnect ────────────────────────────────────────────────────────────────
  function disconnect() {
    clearTimeout(_retryTimer);
    if (_ws) {
      _ws.onclose = null; // prevent reconnect on manual close
      _ws.close();
      _ws = null;
    }
    _connected = false;
    _log("Signaling: disconnected (manual)");
  }

  function isConnected() { return _connected; }

  function _log(msg, type) {
    if (window.debugLog) window.debugLog(msg, type || "network");
    else console.log("[Signaling]", msg);
  }

  return {
    configure,
    connect,
    disconnect,
    sendOffer,
    sendAnswer,
    sendIceCandidate,
    isConnected,
  };

})();
