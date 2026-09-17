const PLAYHOUSE_MESSAGE_SOURCE = "carnival-playhouse";
const OPEN_IN_AUX_MESSAGE_TYPE = "openInAux";
const OPEN_IN_AUX_RESULT_SOURCE = "carnival-playhouse-bridge";
const OPEN_IN_AUX_RESULT_TYPE = "openInAuxResult";
const GET_LOCAL_BRANCHES_MESSAGE_TYPE = "getLocalBranches";
const LOCAL_BRANCHES_RESULT_TYPE = "localBranchesResult";
const BRIDGE_HEALTH_MESSAGE_TYPE = "carnivalBridgeHealth";
const BRIDGE_HEALTH_RESULT_TYPE = "carnivalBridgeHealthResult";

console.info("Carnival Aux bridge content script loaded");
console.info("BRANCH_TREE_BRIDGE_READY");

const playhouseExtensionMessaging = globalThis.CarnivalExtensionMessaging;

function sendPlayhouseExtensionMessage(message) {
  if (playhouseExtensionMessaging?.send) return playhouseExtensionMessaging.send(message);
  return Promise.resolve({
    code: "EXTENSION_CONTEXT_UNAVAILABLE",
    message: "Carnival extension was reloaded. Refresh PlayHouse.",
    ok: false,
  });
}

function logBridgeFailure(event, result) {
  playhouseExtensionMessaging?.reportFailureOnce?.(event, result);
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.source !== PLAYHOUSE_MESSAGE_SOURCE) return;

  if (event.data?.type === GET_LOCAL_BRANCHES_MESSAGE_TYPE) {
    console.info("BRANCH_TREE_EXTENSION_RECEIVED");
    sendPlayhouseExtensionMessage({ type: GET_LOCAL_BRANCHES_MESSAGE_TYPE }).then((result) => {
      const response = result.response;
      if (!result.ok) {
        logBridgeFailure("BRANCH_TREE_FAILED", result);
      } else {
        console[response?.ok ? "info" : "warn"](
          response?.ok ? "BRANCH_TREE_DELIVERED" : "BRANCH_TREE_FAILED",
          response?.summary ?? {},
        );
      }
      window.postMessage({
        branches: response?.ok && Array.isArray(response.branches) ? response.branches : [],
        code: result.ok ? undefined : result.code,
        message: result.ok ? undefined : result.message,
        ok: response?.ok === true,
        requestId: event.data.requestId,
        source: OPEN_IN_AUX_RESULT_SOURCE,
        type: LOCAL_BRANCHES_RESULT_TYPE,
      }, window.location.origin);
    }).catch(() => {
      console.warn("BRANCH_TREE_FAILED", { reason: "bridge_handler_failed" });
      window.postMessage({
        branches: [],
        ok: false,
        requestId: event.data.requestId,
        source: OPEN_IN_AUX_RESULT_SOURCE,
        type: LOCAL_BRANCHES_RESULT_TYPE,
      }, window.location.origin);
    });
    return;
  }
  if (event.data?.type === BRIDGE_HEALTH_MESSAGE_TYPE) {
    sendPlayhouseExtensionMessage({ type: BRIDGE_HEALTH_MESSAGE_TYPE }).then((result) => {
      const response = result.response;
      window.postMessage({
        code: result.ok ? undefined : result.code,
        message: result.ok ? undefined : result.message,
        ok: response?.ok === true,
        requestId: event.data.requestId,
        source: OPEN_IN_AUX_RESULT_SOURCE,
        type: BRIDGE_HEALTH_RESULT_TYPE,
      }, window.location.origin);
    }).catch(() => {
      window.postMessage({
        ok: false,
        requestId: event.data.requestId,
        source: OPEN_IN_AUX_RESULT_SOURCE,
        type: BRIDGE_HEALTH_RESULT_TYPE,
      }, window.location.origin);
    });
    return;
  }
  if (event.data?.type !== OPEN_IN_AUX_MESSAGE_TYPE) return;

  console.info("Carnival Aux bridge request received");
  sendPlayhouseExtensionMessage({
    type: OPEN_IN_AUX_MESSAGE_TYPE,
    url: event.data.url,
  }).then((result) => {
    const response = result.response;
    if (!result.ok || !response?.ok) {
      logBridgeFailure("Carnival Aux routing unavailable", result.ok ? {
        code: "EXTENSION_REQUEST_REJECTED",
        message: response?.error ?? "Carnival extension request was rejected.",
        ok: false,
      } : result);
      if (event.data.requestId) window.postMessage({
        code: result.ok ? "EXTENSION_REQUEST_REJECTED" : result.code,
        message: result.ok ? (response?.error ?? "Carnival extension request was rejected.") : result.message,
        ok: false,
        requestId: event.data.requestId,
        source: OPEN_IN_AUX_RESULT_SOURCE,
        type: OPEN_IN_AUX_RESULT_TYPE,
      }, window.location.origin);
      return;
    }
    console.info("Carnival Aux bridge request completed");
    if (event.data.requestId) window.postMessage({
      ok: true,
      requestId: event.data.requestId,
      source: OPEN_IN_AUX_RESULT_SOURCE,
      type: OPEN_IN_AUX_RESULT_TYPE,
    }, window.location.origin);
  }).catch(() => {
    console.warn("Carnival Aux routing unavailable", { reason: "bridge_handler_failed" });
    if (event.data.requestId) window.postMessage({
      ok: false,
      requestId: event.data.requestId,
      source: OPEN_IN_AUX_RESULT_SOURCE,
      type: OPEN_IN_AUX_RESULT_TYPE,
    }, window.location.origin);
  });
});
