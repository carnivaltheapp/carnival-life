const CARNIVAL_GMAIL_DRAG_TYPE = "application/x-carnival-gmail";
const STORE_PENDING_GMAIL_DRAG = "storePendingGmailDrag";
const GET_PENDING_GMAIL_DRAG = "getPendingGmailDrag";
const CONSUME_PENDING_GMAIL_DRAG = "consumePendingGmailDrag";
const RECORD_GMAIL_DIAGNOSTIC = "recordGmailDiagnostic";
const GMAIL_BRIDGE_VERSION = "P3-GMAIL-PENDING-FIX-41";

function reportGmailDiagnostic(event, details = {}, level = "info") {
  console[level]?.(event, details);
  try {
    chrome.runtime.sendMessage({
      details,
      event,
      level,
      type: RECORD_GMAIL_DIAGNOSTIC,
    }).catch(() => {});
  } catch {}
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
  chrome.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "gmailBridgePing") return false;
    sendResponse({ active: true, scriptVersion: GMAIL_BRIDGE_VERSION });
    return false;
  });

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    reportGmailDiagnostic("GMAIL_POINTER_DOWN", {
      gmailHash: window.location.hash,
      gmailPathname: window.location.pathname,
    });
    clearPreparedDrag();
    const attachment = parseGmailUrl(window.location.href);
    const dragTarget = event.target instanceof Element ? event.target : null;
    if (!attachment || !dragTarget) {
      reportGmailDiagnostic("GMAIL_DRAG_CONTEXT_FAILED", {
        reason: attachment ? "gesture-target-unavailable" : "gmail-thread-url-unavailable",
      }, "warn");
      return;
    }
    const threadContext = latestGmailThreadContext();
    const actionId = crypto.randomUUID();
    preparedDrag = {
      actionId,
      attachment,
      dragStarted: false,
      dragTarget,
      moved: false,
      pointerX: event.clientX,
      pointerY: event.clientY,
      previousDraggable: dragTarget.getAttribute("draggable"),
      threadContext,
    };
    dragTarget.setAttribute("draggable", "true");
    reportGmailDiagnostic("GMAIL_DRAG_CONTEXT_RESOLVED", {
      actionId,
      counterpartyMetadataAvailable: Boolean(threadContext?.from && threadContext?.to?.length),
      directionMetadataAvailable: Boolean(threadContext?.from && threadContext?.to?.length),
      gmailAccountIndex: attachment.accountIndex,
      gmailThreadRef: attachment.threadRef,
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
    const attachment = preparedDrag?.attachment ??
      gmailUrlFromTransfer(event.dataTransfer) ??
      parseGmailUrl(window.location.href);
    if (!attachment) {
      reportGmailDiagnostic("GMAIL_DRAG_CONTEXT_FAILED", {
        reason: "gmail-thread-url-unavailable-at-dragstart",
      }, "warn");
      return;
    }
    const correlationId = preparedDrag?.actionId ?? crypto.randomUUID();
    if (preparedDrag) preparedDrag.dragStarted = true;
    const threadContext = preparedDrag?.threadContext ?? latestGmailThreadContext();
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
    chrome.runtime.sendMessage({
      actionId: correlationId,
      attachment: { ...attachment, threadContext },
      correlationId,
      createdAt: Date.now(),
      type: STORE_PENDING_GMAIL_DRAG,
    }).catch(() => {});
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
    chrome.runtime.sendMessage({ type: GET_PENDING_GMAIL_DRAG }).then((response) => {
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
      chrome.runtime.sendMessage({
        actionId: response.actionId ?? response.correlationId,
        type: CONSUME_PENDING_GMAIL_DRAG,
      }).catch(() => {});
    }).catch(() => {});
  }, true);
}
