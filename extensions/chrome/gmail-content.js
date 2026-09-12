const CARNIVAL_GMAIL_DRAG_TYPE = "application/x-carnival-gmail";
const STORE_PENDING_GMAIL_DRAG = "storePendingGmailDrag";
const RECORD_GMAIL_DIAGNOSTIC = "recordGmailDiagnostic";
const GMAIL_BRIDGE_VERSION = "P3-GMAIL-ARMED-DRAG-44";
const DRAG_THRESHOLD_PX = 6;

let extensionContextStale = false;
let dragGesture = null;

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

function gmailAccountIndex() {
  const match = /^\/mail\/u\/(\d+)\/?$/.exec(window.location.pathname);
  const accountIndex = Number(match?.[1]);
  return Number.isSafeInteger(accountIndex) && accountIndex >= 0 ? accountIndex : null;
}

function gmailAttachment(accountIndex, threadRef) {
  return {
    canonicalUrl: `https://mail.google.com/mail/u/${accountIndex}/#all/${encodeURIComponent(threadRef)}`,
    gmailAccountIndex: accountIndex,
    threadRef,
  };
}

function parseGmailUrl(value) {
  try {
    const url = new URL(value.trim(), window.location.href);
    if (url.protocol !== "https:" || url.hostname !== "mail.google.com") return null;
    const account = /^\/mail\/u\/(\d+)\/?$/.exec(url.pathname);
    const hashParts = url.hash.slice(1).split("/");
    if (!account || hashParts.length < 2) return null;
    const accountIndex = Number(account[1]);
    const threadRef = decodeURIComponent(hashParts.at(-1) ?? "").trim();
    return Number.isSafeInteger(accountIndex) && accountIndex >= 0 && threadRef
      ? gmailAttachment(accountIndex, threadRef)
      : null;
  } catch {
    return null;
  }
}

function gmailParticipant(element) {
  const email = element?.getAttribute?.("email") ?? element?.getAttribute?.("data-hovercard-id");
  if (!email || !email.includes("@")) return null;
  const name = element.getAttribute?.("name") ?? element.textContent?.trim() ?? null;
  return { email: email.trim(), name: name ? name.slice(0, 200) : null };
}

function gmailSelfParticipant() {
  const accountControl = document.querySelector(
    "[aria-label*='Google Account'], [aria-label*='Google account']",
  );
  const label = accountControl?.getAttribute("aria-label") ?? "";
  const email = label.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  return email ? { email, name: null } : null;
}

function latestOpenThreadContext() {
  const latest = Array.from(document.querySelectorAll("[data-message-id]")).at(-1);
  if (!latest) return null;
  const from = gmailParticipant(latest.querySelector(".gD[email], [data-hovercard-id*='@']"));
  const seen = new Set();
  const to = Array.from(latest.querySelectorAll("[email], [data-hovercard-id*='@']"))
    .map(gmailParticipant)
    .filter((participant) => {
      const key = participant?.email.toLowerCase();
      if (!participant || !key || key === from?.email.toLowerCase() || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!from || !to.length) return null;
  const timestamp = latest.querySelector(".g3[title], [data-tooltip]");
  return {
    from,
    lastMessageAt: timestamp?.getAttribute("title") ?? timestamp?.getAttribute("data-tooltip") ?? null,
    to,
  };
}

function gmailThreadRowContext(row) {
  const self = gmailSelfParticipant();
  if (!self) return null;
  const seen = new Set();
  const participants = Array.from(row.querySelectorAll(".yP[email], .zF[email], [email]"))
    .map(gmailParticipant)
    .filter((participant) => {
      const key = participant?.email.toLowerCase();
      if (!participant || !key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const selfEmail = self.email.toLowerCase();
  const counterparties = participants.filter(({ email }) => email.toLowerCase() !== selfEmail);
  if (!counterparties.length) return null;
  const outgoing = /^#sent(?:\/|$)/.test(window.location.hash) ||
    participants.at(-1)?.email.toLowerCase() === selfEmail;
  const timestamp = row.querySelector(".xW [title], .xW [data-tooltip], [data-tooltip]");
  return {
    from: outgoing ? self : counterparties.at(-1),
    lastMessageAt: timestamp?.getAttribute("title") ?? timestamp?.getAttribute("data-tooltip") ?? null,
    to: outgoing ? counterparties : [self],
  };
}

function gmailThreadRefFromRow(row) {
  for (const anchor of row.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    const attachment = href ? parseGmailUrl(href) : null;
    if (attachment) return attachment.threadRef;
  }
  const legacyThreadId = row.getAttribute("data-legacy-thread-id")?.trim();
  if (legacyThreadId) return legacyThreadId;
  const threadId = row.getAttribute("data-thread-id")?.trim();
  if (threadId && !threadId.startsWith("#thread-") && /^[A-Za-z0-9_-]+$/.test(threadId)) {
    return threadId;
  }
  return null;
}

function gmailThreadRowFromEvent(event) {
  const openThread = parseGmailUrl(window.location.href);
  const selector = openThread
    ? "tr.zA, [data-legacy-thread-id]"
    : "tr.zA, [data-legacy-thread-id], [data-thread-id]";
  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (node.matches?.(selector)) return node;
    const row = node.closest?.(selector);
    if (row) return row;
  }
  return null;
}

function resolveGmailDrag(event) {
  const target = event.target;
  if (!(target instanceof Element)) return { reason: "unsupported-gmail-element" };
  const row = gmailThreadRowFromEvent(event);
  if (row) {
    const accountIndex = gmailAccountIndex();
    const threadRef = gmailThreadRefFromRow(row);
    if (accountIndex === null || !threadRef) return { reason: "gmail-thread-row-unresolved" };
    return {
      dragTarget: row,
      pending: {
        ...gmailAttachment(accountIndex, threadRef),
        threadContext: gmailThreadRowContext(row),
      },
      source: "gmail-thread-row",
    };
  }
  const attachment = parseGmailUrl(window.location.href);
  if (!attachment) return { reason: "no-thread-under-pointer" };
  return {
    dragTarget: target.closest("[data-message-id]") ?? target,
    pending: { ...attachment, threadContext: latestOpenThreadContext() },
    source: "open-thread-url",
  };
}

function clearDragGesture(reason = null) {
  if (!dragGesture) return;
  if (reason && dragGesture.state === "candidate") {
    reportDiagnostic("GMAIL_DRAG_CANDIDATE_CANCELLED", {
      actionId: dragGesture.actionId,
      reason,
    });
  }
  if (dragGesture.previousDraggable === null) dragGesture.dragTarget.removeAttribute("draggable");
  else dragGesture.dragTarget.setAttribute("draggable", dragGesture.previousDraggable);
  dragGesture = null;
}

function armDragGesture(trigger) {
  if (!dragGesture || dragGesture.state !== "candidate") return dragGesture?.storePromise ?? null;
  const armedAt = Date.now();
  const record = {
    ...dragGesture.pending,
    actionId: dragGesture.actionId,
    armedAt,
    createdAt: dragGesture.createdAt,
  };
  dragGesture.state = "armed";
  dragGesture.record = record;
  reportDiagnostic("GMAIL_DRAG_ARMED", {
    actionId: record.actionId,
    gmailThreadRef: record.threadRef,
    trigger,
  });
  dragGesture.storePromise = sendRuntimeMessage(
    { pending: record, type: STORE_PENDING_GMAIL_DRAG },
    "store-pending-drag",
  ).then((result) => {
    if (!result?.ok && !extensionContextStale) {
      reportDiagnostic("GMAIL_PENDING_DRAG_STORE_FAILED", {
        actionId: record.actionId,
        reason: result?.reason ?? "background-unavailable",
      }, "warn");
    }
    return result;
  });
  return dragGesture.storePromise;
}

function prepareDrag(event) {
  if (event.button !== 0) return;
  reportDiagnostic("GMAIL_POINTER_DOWN", {
    gmailHash: window.location.hash,
    gmailPathname: window.location.pathname,
  });
  clearDragGesture("superseded-by-new-pointerdown");
  const resolved = resolveGmailDrag(event);
  if (!resolved.pending) {
    reportDiagnostic("GMAIL_DRAG_CONTEXT_FAILED", { reason: resolved.reason }, "warn");
    return;
  }
  const actionId = crypto.randomUUID();
  dragGesture = {
    actionId,
    createdAt: Date.now(),
    dragTarget: resolved.dragTarget,
    pending: resolved.pending,
    pointerId: event.pointerId,
    previousDraggable: resolved.dragTarget.getAttribute("draggable"),
    source: resolved.source,
    startX: event.clientX,
    startY: event.clientY,
    state: "candidate",
    storePromise: null,
  };
  resolved.dragTarget.setAttribute("draggable", "true");
  const details = {
    actionId,
    gmailAccountIndex: resolved.pending.gmailAccountIndex,
    gmailThreadRef: resolved.pending.threadRef,
    source: resolved.source,
  };
  reportDiagnostic("GMAIL_DRAG_TARGET_RESOLVED", details);
  reportDiagnostic("GMAIL_DRAG_CONTEXT_RESOLVED", {
    ...details,
    counterpartyMetadataAvailable: Boolean(
      resolved.pending.threadContext?.from && resolved.pending.threadContext?.to?.length,
    ),
    directionMetadataAvailable: Boolean(
      resolved.pending.threadContext?.from && resolved.pending.threadContext?.to?.length,
    ),
  });
}

function startDrag(event) {
  reportDiagnostic("GMAIL_NATIVE_DRAGSTART", { actionId: dragGesture?.actionId ?? null });
  if (!dragGesture) {
    reportDiagnostic("GMAIL_DRAG_CONTEXT_FAILED", { reason: "dragstart-without-candidate" }, "warn");
    return;
  }
  armDragGesture("native-dragstart");
  if (!event.dataTransfer) {
    reportDiagnostic("GMAIL_DRAG_PAYLOAD_UNAVAILABLE", {
      actionId: dragGesture.actionId,
      reason: "native-data-transfer-unavailable",
    });
    return;
  }
  const record = dragGesture.record;
  const actionId = dragGesture.actionId;
  const transferPayload = JSON.stringify({
    actionId,
    threadContext: record.threadContext,
    url: record.canonicalUrl,
  });
  for (const [type, value] of [
    [CARNIVAL_GMAIL_DRAG_TYPE, transferPayload],
    ["text/uri-list", record.canonicalUrl],
    ["text/plain", record.canonicalUrl],
  ]) {
    try { event.dataTransfer.setData(type, value); } catch {}
  }
  try { event.dataTransfer.effectAllowed = "copy"; } catch {}
  reportDiagnostic("GMAIL_DRAG_PAYLOAD_SET", {
    actionId,
    types: Array.from(event.dataTransfer.types),
  });
}

function trackDragGesture(event) {
  if (!dragGesture || dragGesture.state !== "candidate") return;
  if (event.pointerId !== undefined && dragGesture.pointerId !== undefined &&
    event.pointerId !== dragGesture.pointerId) return;
  const distance = Math.hypot(
    event.clientX - dragGesture.startX,
    event.clientY - dragGesture.startY,
  );
  if (distance >= DRAG_THRESHOLD_PX) armDragGesture("pointer-threshold");
}

function finishPointerGesture(event, reason) {
  if (!dragGesture) return;
  if (event.pointerId !== undefined && dragGesture.pointerId !== undefined &&
    event.pointerId !== dragGesture.pointerId) return;
  clearDragGesture(reason);
}

function reportContentScriptLoaded(reason) {
  reportDiagnostic("GMAIL_CONTENT_SCRIPT_LOADED", {
    gmailHash: window.location.hash,
    gmailPathname: window.location.pathname,
    reason,
    scriptVersion: GMAIL_BRIDGE_VERSION,
  });
}

reportContentScriptLoaded("document-load");
window.addEventListener("hashchange", () => reportContentScriptLoaded("hashchange"));
window.addEventListener("popstate", () => reportContentScriptLoaded("popstate"));
document.addEventListener("pointerdown", prepareDrag, true);
document.addEventListener("pointermove", trackDragGesture, true);
document.addEventListener("dragstart", startDrag, true);
document.addEventListener("dragend", () => clearDragGesture(), true);
document.addEventListener("pointercancel", (event) => finishPointerGesture(event, "pointercancel"), true);
document.addEventListener("pointerup", (event) =>
  finishPointerGesture(event, "pointerup-before-threshold"), true);

try {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "gmailBridgePing") return false;
    sendResponse({ active: true, scriptVersion: GMAIL_BRIDGE_VERSION });
    return false;
  });
} catch {
  markExtensionContextStale("install-ping-listener");
}
