/**
 * module-c.js — Cross-Network Reliability Layer
 * webrtc-network-modules
 *
 * TURN-based relay path for cross-network streaming.
 * Only activated by Module A after Module B reports failure.
 *
 * TURN credentials are injected via configure() — no hardcoding.
 * Works with any TURN provider: Metered.ca, Twilio, Xirsys, self-hosted.
 *
 * Never called directly — always invoked by Module A.
 */

const ModuleC = (function () {

  let _config        = {};
  let _onSuccess     = null;
  let _onFailure     = null;
  let _timeoutHandle = null;
  let _active        = false;

  /**
   * Configure Module C with TURN credentials and options.
   *
   * @param {Object} config
   * @param {Array}  config.turnServers     — ICE servers array with TURN credentials
   * @param {Object} config.timeouts        — { relay: 15000 }
   * @param {string} config.providerName    — display name for logging e.g. "Metered.ca"
   *
   * Example (Metered.ca):
   * ModuleC.configure({
   *   providerName: "Metered.ca",
   *   turnServers: [
   *     { urls: "stun:standard.relay.metered.ca:80" },
   *     { urls: "turn:standard.relay.metered.ca:80", username: "xxx", credential: "yyy" },
   *     { urls: "turn:standard.relay.metered.ca:80?transport=tcp", username: "xxx", credential: "yyy" },
   *     { urls: "turn:standard.relay.metered.ca:443", username: "xxx", credential: "yyy" },
   *     { urls: "turns:standard.relay.metered.ca:443?transport=tcp", username: "xxx", credential: "yyy" },
   *   ]
   * });
   */
  function configure(config) {
    _config = config;
  }

  function attempt(onSuccess, onFailure) {
    _onSuccess = onSuccess;
    _onFailure = onFailure;
    _active    = true;

    const provider = _config.providerName || "TURN relay";
    const hasCredentials = _config.turnServers && _config.turnServers.length > 0;

    if (!hasCredentials) {
      _log("Module C: no TURN credentials configured — relay unavailable", "error");
      _fail("no-credentials");
      return;
    }

    _log("Module C: activating TURN relay via " + provider, "network");

    const timeout = _config.timeouts?.relay || 15000;
    _timeoutHandle = setTimeout(() => {
      if (_active) {
        _log("Module C: TURN relay timed out", "error");
        _fail("timeout");
      }
    }, timeout);
  }

  function onIceStateChange(state) {
    if (!_active) return;
    _log("Module C: ICE state → " + state, "ice");
    if (state === "connected" || state === "completed") {
      _succeed();
    } else if (state === "failed" || state === "closed") {
      _fail(state);
    }
  }

  function getIceConfig() {
    return {
      iceServers:         _config.turnServers || [],
      iceTransportPolicy: "relay",
    };
  }

  function isConfigured() {
    return _config.turnServers && _config.turnServers.length > 0;
  }

  function cancel() {
    _active = false;
    clearTimeout(_timeoutHandle);
    _log("Module C: cancelled");
  }

  function _succeed() {
    if (!_active) return;
    _active = false;
    clearTimeout(_timeoutHandle);
    _log("Module C: TURN relay established ✓", "success");
    if (_onSuccess) _onSuccess();
  }

  function _fail(reason) {
    if (!_active) return;
    _active = false;
    clearTimeout(_timeoutHandle);
    _log("Module C: TURN relay failed (" + reason + ")", "error");
    if (_onFailure) _onFailure(reason);
  }

  function _log(msg, type) {
    if (window.debugLog) window.debugLog(msg, type || "network");
    else console.log("[ModuleC]", msg);
  }

  return { configure, attempt, onIceStateChange, cancel, getIceConfig, isConfigured };

})();
