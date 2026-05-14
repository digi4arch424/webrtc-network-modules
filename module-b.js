/**
 * module-b.js — Local Network Media Path
 * webrtc-network-modules
 *
 * Attempts direct P2P WebRTC connection using STUN only.
 * Reports success or failure back to Module A.
 *
 * Never called directly — always invoked by Module A.
 */

const ModuleB = (function () {

  const DEFAULT_STUN = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ];

  let _config  = {};
  let _onSuccess = null;
  let _onFailure = null;
  let _timeoutHandle = null;
  let _active = false;

  function configure(config) {
    _config = config;
  }

  function attempt(onSuccess, onFailure) {
    _onSuccess = onSuccess;
    _onFailure = onFailure;
    _active    = true;

    _log("Module B: attempting local P2P path");

    const timeout = _config.timeouts?.local || 8000;
    _timeoutHandle = setTimeout(() => {
      if (_active) {
        _log("Module B: local path timed out", "warn");
        _fail("timeout");
      }
    }, timeout);
  }

  function onIceStateChange(state) {
    if (!_active) return;
    _log("Module B: ICE state → " + state, "ice");
    if (state === "connected" || state === "completed") {
      _succeed();
    } else if (state === "failed" || state === "disconnected" || state === "closed") {
      _fail(state);
    }
  }

  function onCandidatePairSelected(localType) {
    if (!_active) return;
    if (localType === "relay") {
      _log("Module B: relay candidate selected — local path not available", "warn");
      _fail("relay-selected");
    }
  }

  function getIceConfig() {
    return {
      iceServers:         _config.stunServers || DEFAULT_STUN,
      iceTransportPolicy: "all",
    };
  }

  function cancel() {
    _active = false;
    clearTimeout(_timeoutHandle);
    _log("Module B: cancelled");
  }

  function _succeed() {
    if (!_active) return;
    _active = false;
    clearTimeout(_timeoutHandle);
    _log("Module B: local path established ✓", "success");
    if (_onSuccess) _onSuccess();
  }

  function _fail(reason) {
    if (!_active) return;
    _active = false;
    clearTimeout(_timeoutHandle);
    _log("Module B: local path failed (" + reason + ") → handing off to Module C", "warn");
    if (_onFailure) _onFailure(reason);
  }

  function _log(msg, type) {
    if (window.debugLog) window.debugLog(msg, type || "network");
    else console.log("[ModuleB]", msg);
  }

  return { configure, attempt, onIceStateChange, onCandidatePairSelected, cancel, getIceConfig };

})();
