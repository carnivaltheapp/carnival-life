const PLAYHOUSE_MESSAGE_SOURCE = "carnival-playhouse";
const OPEN_IN_AUX_MESSAGE_TYPE = "openInAux";

console.info("Carnival Aux bridge content script loaded");

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.source !== PLAYHOUSE_MESSAGE_SOURCE ||
    event.data?.type !== OPEN_IN_AUX_MESSAGE_TYPE) return;

  console.info("Carnival Aux bridge request received");
  chrome.runtime.sendMessage({
    type: OPEN_IN_AUX_MESSAGE_TYPE,
    url: event.data.url,
  }).then((response) => {
    if (!response?.ok) throw new Error(response?.error ?? "The extension did not route the request.");
    console.info("Carnival Aux bridge request completed");
  }).catch((error) => console.error("Carnival Aux routing failed", error));
});
