const CARNIVAL_GMAIL_DRAG_TYPE = "application/x-carnival-gmail";
const GET_PENDING_GMAIL_DRAG = "getPendingGmailDrag";
const CONSUME_PENDING_GMAIL_DRAG = "consumePendingGmailDrag";
const RECORD_GMAIL_DIAGNOSTIC = "recordGmailDiagnostic";

let extensionContextStale = false;
let gmailDragActive = false;
let activeRow = null;

function extensionContextInvalidated(error) {
  return String(error?.message ?? error).toLowerCase().includes("extension context invalidated");
}

function markExtensionContextStale(stage) {
  if (extensionContextStale) return;
  extensionContextStale = true;
  console.warn("GMAIL_EXTENSION_CONTEXT_INVALIDATED", { stage });
}

function sendRuntimeMessage(message, stage) {
  if (extensionContextStale) return Promise.resolve(null);
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.id ||
      typeof chrome.runtime.sendMessage !== "function") {
      markExtensionContextStale(stage);
      return Promise.resolve(null);
    }
    return Promise.resolve(chrome.runtime.sendMessage(message)).catch((error) => {
      if (extensionContextInvalidated(error)) markExtensionContextStale(stage);
      else console.warn("GMAIL_EXTENSION_MESSAGE_FAILED", { reason: "message-rejected", stage });
      return null;
    });
  } catch (error) {
    if (extensionContextInvalidated(error)) markExtensionContextStale(stage);
    else console.warn("GMAIL_EXTENSION_MESSAGE_FAILED", { reason: "message-threw", stage });
    return Promise.resolve(null);
  }
}

function reportDiagnostic(event, details = {}, level = "info") {
  console[level]?.(event, details);
  sendRuntimeMessage({ details, event, level, type: RECORD_GMAIL_DIAGNOSTIC }, `diagnostic:${event}`);
}

function transferLooksLikeGmail(dataTransfer) {
  const types = Array.from(dataTransfer?.types ?? []);
  if (types.includes(CARNIVAL_GMAIL_DRAG_TYPE) || types.includes("text/uri-list")) return true;
  for (const type of ["text/plain", "text/uri-list"]) {
    try {
      if ((dataTransfer?.getData(type) ?? "").includes("https://mail.google.com/")) return true;
    } catch {}
  }
  return false;
}

function playRowAtEvent(event) {
  const direct = event.target instanceof Element
    ? event.target.closest("[data-play-row-id]")
    : null;
  if (direct) return direct;
  const pointed = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
    ? document.elementFromPoint?.(event.clientX, event.clientY)
    : null;
  return pointed instanceof Element ? pointed.closest("[data-play-row-id]") : null;
}

function setActiveRow(row) {
  if (activeRow === row) return;
  activeRow?.removeAttribute("data-gmail-drop-target");
  activeRow = row;
  activeRow?.setAttribute("data-gmail-drop-target", "true");
}

function clearDragState() {
  setActiveRow(null);
  gmailDragActive = false;
}

function acceptDragOver(event) {
  if (!gmailDragActive && !transferLooksLikeGmail(event.dataTransfer)) return false;
  gmailDragActive = true;
  const row = playRowAtEvent(event);
  const playId = row?.getAttribute("data-play-row-id");
  if (!row || !playId) return false;
  event.preventDefault();
  try { event.dataTransfer.dropEffect = "copy"; } catch {}
  if (activeRow !== row) {
    setActiveRow(row);
    reportDiagnostic("GMAIL_DRAG_OVER_PLAY", { playId });
  }
  return true;
}

window.addEventListener("carnival:gmail-diagnostic", (event) => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
  try {
    const diagnostic = JSON.parse(event.detail);
    if (typeof diagnostic.event !== "string" || !diagnostic.event.startsWith("GMAIL_")) return;
    reportDiagnostic(diagnostic.event, diagnostic.details ?? {});
  } catch {}
});

window.addEventListener("carnival:gmail-drop-handoff", (event) => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
  try {
    const handoff = JSON.parse(event.detail);
    if (!handoff.accepted || typeof handoff.actionId !== "string") {
      reportDiagnostic("GMAIL_DROP_HANDOFF_FAILED", {
        actionId: handoff.actionId ?? null,
        reason: handoff.reason ?? "application-rejected",
      }, "warn");
      return;
    }
    sendRuntimeMessage({
      actionId: handoff.actionId,
      type: CONSUME_PENDING_GMAIL_DRAG,
    }, "consume-pending-drag");
  } catch {
    reportDiagnostic("GMAIL_DROP_HANDOFF_FAILED", { reason: "invalid-application-response" }, "warn");
  }
});

document.addEventListener("dragenter", (event) => {
  if (!gmailDragActive && !transferLooksLikeGmail(event.dataTransfer)) return;
  gmailDragActive = true;
  const row = playRowAtEvent(event);
  const playId = row?.getAttribute("data-play-row-id") ?? null;
  reportDiagnostic("GMAIL_DRAG_ENTER_PH", { playId });
  if (row) setActiveRow(row);
}, true);

document.addEventListener("dragover", acceptDragOver, true);

document.addEventListener("dragleave", (event) => {
  if (!gmailDragActive || event.relatedTarget) return;
  clearDragState();
}, true);

document.addEventListener("drop", (event) => {
  if (!gmailDragActive && !transferLooksLikeGmail(event.dataTransfer)) return;
  const row = playRowAtEvent(event);
  const playId = row?.getAttribute("data-play-row-id");
  clearDragState();
  if (!playId) {
    reportDiagnostic("GMAIL_DROP_TARGET_MISSING", { reason: "play-row-not-under-pointer" }, "warn");
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  reportDiagnostic("GMAIL_NATIVE_DROP_CAPTURED", {
    dataTransferTypes: Array.from(event.dataTransfer?.types ?? []),
    playId,
  });
  sendRuntimeMessage({ type: GET_PENDING_GMAIL_DRAG }, "get-pending-drag").then((response) => {
    const pending = response?.pending;
    if (!pending?.actionId || !pending?.canonicalUrl) {
      reportDiagnostic("GMAIL_PENDING_DRAG_MISSING", {
        playId,
        reason: response?.reason ?? "background-unavailable",
      }, "warn");
      return;
    }
    reportDiagnostic("GMAIL_PENDING_DRAG_USED", { actionId: pending.actionId, playId });
    reportDiagnostic("GMAIL_DROP_ON_PLAY", { actionId: pending.actionId, playId });
    window.dispatchEvent(new CustomEvent("carnival:gmail-drop", {
      detail: JSON.stringify({
        actionId: pending.actionId,
        playId,
        threadContext: pending.threadContext,
        url: pending.canonicalUrl,
      }),
    }));
  });
}, true);
