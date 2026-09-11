const PLAYHOUSE_MESSAGE_SOURCE = "carnival-playhouse";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.source !== PLAYHOUSE_MESSAGE_SOURCE || event.data?.type !== "openInAux") return;

  chrome.runtime.sendMessage({
    type: "openCarnivalContext",
    url: event.data.url,
  }).catch((error) => console.error("Carnival Aux routing failed", error));
});
