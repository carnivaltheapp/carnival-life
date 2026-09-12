const CARNIVAL_GMAIL_DRAG_TYPE = "application/x-carnival-gmail";
const STORE_PENDING_GMAIL_DRAG = "storePendingGmailDrag";
const GET_PENDING_GMAIL_DRAG = "getPendingGmailDrag";
const CONSUME_PENDING_GMAIL_DRAG = "consumePendingGmailDrag";
const RECORD_GMAIL_DIAGNOSTIC = "recordGmailDiagnostic";
const GMAIL_BRIDGE_VERSION = "P3-GMAIL-DRAG-ROBUST-42";

function extensionContextInvalidated(error) {
  return String(error?.message ?? error).toLowerCase().includes("extension context invalidated");
}

function sendRuntimeMessage(message, stage) {
  try {
    return Promise.resolve(chrome.runtime.sendMessage(message)).catch((error) => {
      if (extensionContextInvalidated(error)) {
        console.warn("GMAIL_EXTENSION_CONTEXT_INVALIDATED", { stage });
      } else {
        console.warn("GMAIL_EXTENSION_MESSAGE_FAILED", { reason: "runtime-message-rejected", stage });
      }
      return null;
    });
  } catch (error) {
    console.warn(
      extensionContextInvalidated(error)
        ? "GMAIL_EXTENSION_CONTEXT_INVALIDATED"
        : "GMAIL_EXTENSION_MESSAGE_FAILED",
      { reason: "runtime-message-threw", stage },
    );
    return Promise.resolve(null);
  }
}

function reportGmailDiagnostic(event, details = {}, level = "info") {
  console[level]?.(event, details);
  sendRuntimeMessage({
    details,
    event,
    level,
    type: RECORD_GMAIL_DIAGNOSTIC,
  }, `diagnostic:${event}`);
}

function parseGmailUrl(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "mail.google.com") return null;
    const account = /^\/mail\/u\/(\d+)\/?$/.exec(url.pathname);
    const hashParts = url.hash.slice(1).split("/");
    if (!account || hashParts.length < 2) return null;
    const accountIndex = Number(account[1]);
    const threadRef = decodeURIComponent(hashParts.at(-1) ?? "").trim();
    if (!Number.isSafeInteger(accountIndex) || accountIndex < 0 || !threadRef) return null;
    return {
      accountIndex,
      canonicalUrl: `https://mail.google.com/mail/u/${accountIndex}/#all/${encodeURIComponent(threadRef)}`,
      threadRef,
    };
  } catch {
    return null;
  }
}

function gmailUrlFromTransfer(dataTransfer) {
  for (const type of [CARNIVAL_GMAIL_DRAG_TYPE, "text/uri-list", "text/plain", "text/html"]) {
    const raw = dataTransfer?.getData(type) ?? "";
    if (!raw) continue;
    if (type === CARNIVAL_GMAIL_DRAG_TYPE) {
      try {
        const parsed = JSON.parse(raw);
        const attachment = typeof parsed.url === "string" ? parseGmailUrl(parsed.url) : null;
        if (attachment) return attachment;
      } catch {}
      continue;
    }
    const match = raw.replaceAll("&amp;", "&")
      .match(/https:\/\/mail\.google\.com\/[^\s"'<>]+/i)?.[0];
    const attachment = match ? parseGmailUrl(match) : null;
    if (attachment) return attachment;
  }
  return null;
}

function gmailCustomPayload(dataTransfer) {
  try {
    const parsed = JSON.parse(dataTransfer?.getData(CARNIVAL_GMAIL_DRAG_TYPE) ?? "");
    const attachment = typeof parsed.url === "string" ? parseGmailUrl(parsed.url) : null;
    if (!attachment) return null;
    return {
      attachment,
      correlationId: typeof parsed.correlationId === "string" ? parsed.correlationId : null,
      threadContext: parsed.threadContext ?? null,
    };
  } catch {
    return null;
  }
}

function mayBeGmailExternalDrag(dataTransfer) {
  const types = Array.from(dataTransfer?.types ?? []);
  return types.includes(CARNIVAL_GMAIL_DRAG_TYPE) || types.includes("text/uri-list");
}

function gmailParticipant(element) {
  const email = element?.getAttribute?.("email") ?? element?.getAttribute?.("data-hovercard-id");
  if (!email || !email.includes("@")) return null;
  const name = element.getAttribute?.("name") ?? element.textContent?.trim() ?? null;
  return { email: email.trim(), name: name ? name.slice(0, 200) : null };
}

function gmailAccountIndex() {
  const match = /^\/mail\/u\/(\d+)\/?$/.exec(window.location.pathname);
  const accountIndex = Number(match?.[1]);
  return Number.isSafeInteger(accountIndex) && accountIndex >= 0 ? accountIndex : null;
}

function gmailAttachment(accountIndex, threadRef) {
  return {
    accountIndex,
    canonicalUrl: `https://mail.google.com/mail/u/${accountIndex}/#all/${encodeURIComponent(threadRef)}`,
    threadRef,
  };
}

function gmailSelfParticipant() {
  const accountControl = document.querySelector(
    "[aria-label*='Google Account'], [aria-label*='Google account']",
  );
  const label = accountControl?.getAttribute("aria-label") ?? "";
  const email = label.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  return email ? { email, name: null } : null;
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
  const latestParticipant = participants.at(-1);
  const sentView = /^#sent(?:\/|$)/.test(window.location.hash);
  const outgoing = sentView || latestParticipant?.email.toLowerCase() === selfEmail;
  const timestamp = row.querySelector(".xW [title], .xW [data-tooltip], [data-tooltip]");
  return {
    from: outgoing ? self : counterparties.at(-1),
    lastMessageAt: timestamp?.getAttribute("title") ?? timestamp?.getAttribute("data-tooltip") ?? null,
    to: outgoing ? counterparties : [self],
  };
}

function gmailThreadRefFromRow(row) {
  const legacyThreadId = row.getAttribute("data-legacy-thread-id")?.trim();
  if (legacyThreadId) return legacyThreadId;
  const threadId = row.getAttribute("data-thread-id")?.trim();
  if (threadId && !threadId.startsWith("#thread-") && /^[A-Za-z0-9_-]+$/.test(threadId)) {
    return threadId;
  }
  for (const anchor of row.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    const attachment = parseGmailUrl(new URL(href, window.location.href).href);
    if (attachment) return attachment.threadRef;
  }
  return null;
}

function resolveGmailDragContext(target) {
  if (!(target instanceof Element)) {
    return { reason: "unsupported-gmail-element" };
  }
  const openThread = parseGmailUrl(window.location.href);
  if (openThread) {
    return {
      attachment: openThread,
      source: "open-thread-url",
      threadContext: latestGmailThreadContext(),
    };
  }
  const accountIndex = gmailAccountIndex();
  const row = target.closest("[data-legacy-thread-id], [data-thread-id], tr.zA");
  if (accountIndex === null || !row) return { reason: "no-thread-under-pointer" };
  const threadRef = gmailThreadRefFromRow(row);
  if (!threadRef) return { reason: "unsupported-gmail-element" };
  return {
    attachment: gmailAttachment(accountIndex, threadRef),
    source: "gmail-thread-row",
    threadContext: gmailThreadRowContext(row),
  };
}

function latestGmailThreadContext() {
  const messages = Array.from(document.querySelectorAll("[data-message-id]"));
  const latest = messages.at(-1);
  if (!latest) return null;
  const from = gmailParticipant(
    latest.querySelector(".gD[email], [data-hovercard-id*='@']"),
  );
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

if (window.location.hostname === "mail.google.com") {
  let preparedDrag = null;

  function clearPreparedDrag(reportMissingDragstart = false) {
    if (!preparedDrag) return;
    if (reportMissingDragstart && preparedDrag.moved && !preparedDrag.dragStarted) {
      reportGmailDiagnostic("GMAIL_DRAGSTART_NOT_FIRED", {
        actionId: preparedDrag.actionId,
        gmailAccountIndex: preparedDrag.attachment.accountIndex,
        gmailThreadRef: preparedDrag.attachment.threadRef,
        reason: "pointer-moved-without-native-dragstart",
      }, "warn");
    }
    if (preparedDrag.previousDraggable === null) {
      preparedDrag.dragTarget.removeAttribute("draggable");
    } else {
      preparedDrag.dragTarget.setAttribute("draggable", preparedDrag.previousDraggable);
    }
    preparedDrag = null;
  }

  function reportContentScriptLoaded(reason) {
    reportGmailDiagnostic("GMAIL_CONTENT_SCRIPT_LOADED", {
      gmailHash: window.location.hash,
      gmailPathname: window.location.pathname,
      reason,
      scriptVersion: GMAIL_BRIDGE_VERSION,
    });
  }

  reportContentScriptLoaded("document-load");
  window.addEventListener("hashchange", () => reportContentScriptLoaded("hashchange"));
  window.addEventListener("popstate", () => reportContentScriptLoaded("popstate"));
  try {
    chrome.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "gmailBridgePing") return false;
      sendResponse({ active: true, scriptVersion: GMAIL_BRIDGE_VERSION });
      return false;
    });
  } catch (error) {
    if (extensionContextInvalidated(error)) {
      console.warn("GMAIL_EXTENSION_CONTEXT_INVALIDATED", { stage: "install-ping-listener" });
    }
  }

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    reportGmailDiagnostic("GMAIL_POINTER_DOWN", {
      gmailHash: window.location.hash,
      gmailPathname: window.location.pathname,
    });
    clearPreparedDrag();
    const dragTarget = event.target instanceof Element ? event.target : null;
    const resolved = resolveGmailDragContext(event.target);
    if (!resolved.attachment || !dragTarget) {
      reportGmailDiagnostic("GMAIL_DRAG_CONTEXT_FAILED", {
        reason: resolved.reason ?? "unsupported-gmail-element",
      }, "warn");
      return;
    }
    const actionId = crypto.randomUUID();
    preparedDrag = {
      actionId,
      attachment: resolved.attachment,
      dragStarted: false,
      dragTarget,
      moved: false,
      pointerX: event.clientX,
      pointerY: event.clientY,
      previousDraggable: dragTarget.getAttribute("draggable"),
      source: resolved.source,
      threadContext: resolved.threadContext,
    };
    dragTarget.setAttribute("draggable", "true");
    reportGmailDiagnostic("GMAIL_DRAG_TARGET_RESOLVED", {
      actionId,
      gmailAccountIndex: resolved.attachment.accountIndex,
      gmailThreadRef: resolved.attachment.threadRef,
      source: resolved.source,
    });
    reportGmailDiagnostic("GMAIL_DRAG_CONTEXT_RESOLVED", {
      actionId,
      counterpartyMetadataAvailable: Boolean(resolved.threadContext?.from && resolved.threadContext?.to?.length),
      directionMetadataAvailable: Boolean(resolved.threadContext?.from && resolved.threadContext?.to?.length),
      gmailAccountIndex: resolved.attachment.accountIndex,
      gmailThreadRef: resolved.attachment.threadRef,
      source: resolved.source,
    });
  }, true);

  document.addEventListener("mousedown", (event) => {
    if (event.button === 0) {
      reportGmailDiagnostic("GMAIL_MOUSE_DOWN", {
        gmailHash: window.location.hash,
        gmailPathname: window.location.pathname,
      });
    }
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (!preparedDrag || preparedDrag.moved) return;
    preparedDrag.moved = Math.abs(event.clientX - preparedDrag.pointerX) >= 8 ||
      Math.abs(event.clientY - preparedDrag.pointerY) >= 8;
  }, true);

  document.addEventListener("dragstart", (event) => {
    reportGmailDiagnostic("GMAIL_NATIVE_DRAGSTART", {
      actionId: preparedDrag?.actionId ?? null,
      gmailHost: "mail.google.com",
    });
    if (!event.dataTransfer) {
      reportGmailDiagnostic("GMAIL_DRAG_CONTEXT_FAILED", {
        reason: "native-data-transfer-unavailable",
      }, "warn");
      return;
    }
    const resolved = preparedDrag ? null : resolveGmailDragContext(event.target);
    const attachment = preparedDrag?.attachment ??
      gmailUrlFromTransfer(event.dataTransfer) ??
      resolved?.attachment;
    if (!attachment) {
      reportGmailDiagnostic("GMAIL_DRAG_CONTEXT_FAILED", {
        reason: "gmail-thread-url-unavailable-at-dragstart",
      }, "warn");
      return;
    }
    const correlationId = preparedDrag?.actionId ?? crypto.randomUUID();
    if (preparedDrag) preparedDrag.dragStarted = true;
    const threadContext = preparedDrag?.threadContext ?? resolved?.threadContext ?? null;
    const payload = {
      correlationId,
      threadContext,
      url: attachment.canonicalUrl,
    };
    try {
      event.dataTransfer.setData(CARNIVAL_GMAIL_DRAG_TYPE, JSON.stringify(payload));
    } catch {}
    try {
      event.dataTransfer.setData("text/uri-list", attachment.canonicalUrl);
    } catch {}
    try {
      event.dataTransfer.setData("text/plain", attachment.canonicalUrl);
    } catch {}
    try {
      event.dataTransfer.effectAllowed = "copy";
    } catch {}
    reportGmailDiagnostic("GMAIL_DRAG_PAYLOAD_SET", {
      actionId: correlationId,
      correlationId,
      types: Array.from(event.dataTransfer.types),
    });
    reportGmailDiagnostic("GMAIL_DRAG_STARTED", {
      actionId: correlationId,
      correlationId,
      gmailAccountIndex: attachment.accountIndex,
      gmailHost: "mail.google.com",
      gmailThreadRef: attachment.threadRef,
    });
    reportGmailDiagnostic("GMAIL_DRAG_PAYLOAD", {
      actionId: correlationId,
      correlationId,
      types: Array.from(event.dataTransfer.types),
    });
    sendRuntimeMessage({
      actionId: correlationId,
      attachment: { ...attachment, threadContext },
      correlationId,
      createdAt: Date.now(),
      type: STORE_PENDING_GMAIL_DRAG,
    }, "store-pending-drag");
  }, true);
  document.addEventListener("dragend", (event) => {
    reportGmailDiagnostic("GMAIL_SOURCE_DRAGEND", {
      actionId: preparedDrag?.actionId ?? null,
      dropEffect: event.dataTransfer?.dropEffect ?? null,
      effectAllowed: event.dataTransfer?.effectAllowed ?? null,
    });
    clearPreparedDrag(false);
  }, true);
  document.addEventListener("pointercancel", () => clearPreparedDrag(true), true);
  document.addEventListener("pointerup", () => clearPreparedDrag(true), true);
} else {
  let enteredPlayId = null;
  let overPlayId = null;

  window.addEventListener("carnival:gmail-diagnostic", (event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
    try {
      const diagnostic = JSON.parse(event.detail);
      if (typeof diagnostic.event !== "string" || !diagnostic.event.startsWith("GMAIL_")) return;
      reportGmailDiagnostic(diagnostic.event, diagnostic.details ?? {});
    } catch {}
  });

  document.addEventListener("dragenter", (event) => {
    if (!mayBeGmailExternalDrag(event.dataTransfer)) return;
    const row = event.target instanceof Element
      ? event.target.closest("[data-play-row-id]")
      : null;
    const playId = row?.getAttribute("data-play-row-id");
    if (!playId || enteredPlayId === playId) return;
    enteredPlayId = playId;
    reportGmailDiagnostic("GMAIL_DRAG_ENTER_PH", { playId });
  }, true);

  document.addEventListener("dragover", (event) => {
    if (!mayBeGmailExternalDrag(event.dataTransfer)) return;
    const row = event.target instanceof Element
      ? event.target.closest("[data-play-row-id]")
      : null;
    const playId = row?.getAttribute("data-play-row-id");
    if (!playId) return;
    event.preventDefault();
    try {
      event.dataTransfer.dropEffect = "copy";
    } catch {}
    if (overPlayId !== playId) {
      overPlayId = playId;
      reportGmailDiagnostic("GMAIL_DRAG_OVER_PLAY", { playId });
    }
  }, true);

  document.addEventListener("dragleave", (event) => {
    if (!enteredPlayId || event.relatedTarget) return;
    reportGmailDiagnostic("GMAIL_DRAG_LEAVE_PH", { playId: enteredPlayId });
    enteredPlayId = null;
    overPlayId = null;
  }, true);

  document.addEventListener("drop", (event) => {
    if (!event.dataTransfer) return;
    const row = event.target instanceof Element
      ? event.target.closest("[data-play-row-id]")
      : null;
    const playId = row?.getAttribute("data-play-row-id");
    if (!playId) return;
    const customPayload = gmailCustomPayload(event.dataTransfer);
    const transferredAttachment = gmailUrlFromTransfer(event.dataTransfer);
    const recognizedBeforeDrop = enteredPlayId === playId || overPlayId === playId;
    enteredPlayId = null;
    overPlayId = null;
    if (
      !customPayload &&
      !transferredAttachment &&
      !mayBeGmailExternalDrag(event.dataTransfer) &&
      !recognizedBeforeDrop
    ) {
      return;
    }
    reportGmailDiagnostic("GMAIL_NATIVE_DROP_CAPTURED", {
      actionId: customPayload?.correlationId ?? null,
      dataTransferTypes: Array.from(event.dataTransfer.types),
      playId,
    });
    if (customPayload?.threadContext) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    reportGmailDiagnostic("GMAIL_DRAG_PAYLOAD_MISSING", {
      playId,
      reason: transferredAttachment
        ? "sanitized-thread-context-missing"
        : "gmail-url-and-thread-context-missing",
    }, "warn");
    sendRuntimeMessage({ type: GET_PENDING_GMAIL_DRAG }, "get-pending-drag").then((response) => {
      if (!response?.attachment || !response?.correlationId) {
        reportGmailDiagnostic("GMAIL_PENDING_DRAG_MISSING", { playId }, "warn");
        return;
      }
      reportGmailDiagnostic("GMAIL_PENDING_DRAG_USED", {
        actionId: response.actionId ?? response.correlationId,
        correlationId: response.correlationId,
        playId,
      });
      window.dispatchEvent(new CustomEvent("carnival:gmail-drop-fallback", {
        detail: JSON.stringify({
          correlationId: response.correlationId,
          playId,
          threadContext: response.attachment.threadContext,
          url: response.attachment.canonicalUrl,
        }),
      }));
      sendRuntimeMessage({
        actionId: response.actionId ?? response.correlationId,
        type: CONSUME_PENDING_GMAIL_DRAG,
      }, "consume-pending-drag");
    });
  }, true);
}
