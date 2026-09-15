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

async function sendExtensionMessage(message) {
  try {
    const runtime = globalThis.chrome?.runtime;
    if (typeof runtime?.sendMessage !== "function") {
      return { bridgeFailure: "runtime_unavailable", ok: false };
    }
    const response = await runtime.sendMessage(message);
    return response ?? { bridgeFailure: "missing_response", ok: false };
  } catch (error) {
    const invalidated = String(error?.message ?? error).includes("Extension context invalidated");
    return {
      bridgeFailure: invalidated ? "extension_context_invalidated" : "runtime_message_failed",
      ok: false,
    };
  }
}

function logBridgeFailure(event, response) {
  console.warn(event, { reason: response?.bridgeFailure ?? response?.error ?? "request_failed" });
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.source !== PLAYHOUSE_MESSAGE_SOURCE) return;

  if (event.data?.type === GET_LOCAL_BRANCHES_MESSAGE_TYPE) {
    console.info("BRANCH_TREE_EXTENSION_RECEIVED");
    sendExtensionMessage({ type: GET_LOCAL_BRANCHES_MESSAGE_TYPE }).then((response) => {
      if (response.bridgeFailure) {
        logBridgeFailure("BRANCH_TREE_FAILED", response);
      } else {
        console[response?.ok ? "info" : "warn"](
          response?.ok ? "BRANCH_TREE_DELIVERED" : "BRANCH_TREE_FAILED",
          response?.summary ?? {},
        );
      }
      window.postMessage({
        branches: response?.ok && Array.isArray(response.branches) ? response.branches : [],
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
    sendExtensionMessage({ type: BRIDGE_HEALTH_MESSAGE_TYPE }).then((response) => {
      window.postMessage({
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
  sendExtensionMessage({
    type: OPEN_IN_AUX_MESSAGE_TYPE,
    url: event.data.url,
  }).then((response) => {
    if (!response?.ok) {
      logBridgeFailure("Carnival Aux routing unavailable", response);
      if (event.data.requestId) window.postMessage({
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
