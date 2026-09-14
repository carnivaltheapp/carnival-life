const PLAYHOUSE_MESSAGE_SOURCE = "carnival-playhouse";
const OPEN_IN_AUX_MESSAGE_TYPE = "openInAux";
const OPEN_IN_AUX_RESULT_SOURCE = "carnival-playhouse-bridge";
const OPEN_IN_AUX_RESULT_TYPE = "openInAuxResult";
const GET_LOCAL_BRANCHES_MESSAGE_TYPE = "getLocalBranches";
const LOCAL_BRANCHES_RESULT_TYPE = "localBranchesResult";

console.info("Carnival Aux bridge content script loaded");

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.source !== PLAYHOUSE_MESSAGE_SOURCE) return;

  if (event.data?.type === GET_LOCAL_BRANCHES_MESSAGE_TYPE) {
    chrome.runtime.sendMessage({ type: GET_LOCAL_BRANCHES_MESSAGE_TYPE }).then((response) => {
      window.postMessage({
        branches: response?.ok && Array.isArray(response.branches) ? response.branches : [],
        ok: response?.ok === true,
        requestId: event.data.requestId,
        source: OPEN_IN_AUX_RESULT_SOURCE,
        type: LOCAL_BRANCHES_RESULT_TYPE,
      }, window.location.origin);
    }).catch(() => window.postMessage({
      branches: [],
      ok: false,
      requestId: event.data.requestId,
      source: OPEN_IN_AUX_RESULT_SOURCE,
      type: LOCAL_BRANCHES_RESULT_TYPE,
    }, window.location.origin));
    return;
  }
  if (event.data?.type !== OPEN_IN_AUX_MESSAGE_TYPE) return;

  console.info("Carnival Aux bridge request received");
  chrome.runtime.sendMessage({
    type: OPEN_IN_AUX_MESSAGE_TYPE,
    url: event.data.url,
  }).then((response) => {
    if (!response?.ok) throw new Error(response?.error ?? "The extension did not route the request.");
    console.info("Carnival Aux bridge request completed");
    if (event.data.requestId) window.postMessage({
      ok: true,
      requestId: event.data.requestId,
      source: OPEN_IN_AUX_RESULT_SOURCE,
      type: OPEN_IN_AUX_RESULT_TYPE,
    }, window.location.origin);
  }).catch((error) => {
    console.error("Carnival Aux routing failed", error);
    if (event.data.requestId) window.postMessage({
      ok: false,
      requestId: event.data.requestId,
      source: OPEN_IN_AUX_RESULT_SOURCE,
      type: OPEN_IN_AUX_RESULT_TYPE,
    }, window.location.origin);
  });
});
