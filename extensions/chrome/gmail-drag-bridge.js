const GET_GMAIL_THREAD_PARTICIPANTS = "getGmailThreadParticipants";
const GET_VISIBLE_GMAIL_PARTICIPANTS = "getVisibleGmailParticipants";
const STAR_GMAIL_THREAD = "starGmailThread";
const STAR_VISIBLE_GMAIL_THREAD = "starVisibleGmailThread";
const UNSTAR_GMAIL_THREAD = "unstarGmailThread";
const UNSTAR_VISIBLE_GMAIL_THREAD = "unstarVisibleGmailThread";

const gmailExtensionMessaging = globalThis.CarnivalExtensionMessaging;

function sendGmailExtensionMessage(message) {
  if (gmailExtensionMessaging?.send) return gmailExtensionMessaging.send(message);
  return Promise.resolve({
    code: "EXTENSION_CONTEXT_UNAVAILABLE",
    message: "Carnival extension was reloaded. Refresh PlayHouse.",
    ok: false,
  });
}

function bridgeHandlerFailure() {
  return {
    code: "BRIDGE_HANDLER_FAILED",
    message: "Carnival extension response could not be processed.",
    ok: false,
  };
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
  for (const type of ["text/uri-list", "text/plain", "text/html"]) {
    const raw = dataTransfer?.getData(type) ?? "";
    if (!raw) continue;
    const match = raw.replaceAll("&amp;", "&")
      .match(/https:\/\/mail\.google\.com\/[^\s"'<>]+/i)?.[0];
    const attachment = match ? parseGmailUrl(match) : null;
    if (attachment) return attachment;
  }
  return null;
}

function gmailParticipant(element) {
  const email = element?.getAttribute?.("email") ?? element?.getAttribute?.("data-hovercard-id");
  if (!email || !email.includes("@")) return null;
  const name = element.getAttribute?.("name") ?? element.textContent?.trim() ?? null;
  return {
    email: email.trim().toLowerCase().slice(0, 320),
    name: name ? name.trim().slice(0, 200) : null,
  };
}

function latestVisibleGmailMessage() {
  const messages = Array.from(document.querySelectorAll("[data-message-id]"));
  return messages.filter((message) => {
    if (message.getAttribute?.("aria-hidden") === "true") return false;
    return typeof message.getClientRects !== "function" || message.getClientRects().length > 0;
  }).at(-1) ?? null;
}

function visibleGmailApiThreadId(message) {
  const conversation = message?.closest?.("div[role='main']");
  const header = conversation?.querySelector?.("h2[data-legacy-thread-id]");
  const value = header?.getAttribute?.("data-legacy-thread-id") ??
    message?.getAttribute?.("data-legacy-thread-id") ??
    message?.closest?.("[data-legacy-thread-id]")?.getAttribute?.("data-legacy-thread-id");
  const normalized = value?.trim?.() ?? "";
  return /^[a-zA-Z0-9_-]{1,200}$/.test(normalized) ? normalized : null;
}

function latestGmailParticipants() {
  const latest = latestVisibleGmailMessage();
  if (!latest) return { participants: null, reason: "latest_visible_message_not_found" };
  const from = gmailParticipant(latest.querySelector(".gD[email], [data-hovercard-id*='@']"));
  if (!from) return { participants: null, reason: "from_participant_not_found" };
  const seen = new Set();
  const to = Array.from(latest.querySelectorAll("[email], [data-hovercard-id*='@']"))
    .map(gmailParticipant)
    .filter((participant) => {
      const email = participant?.email.toLowerCase();
      if (!participant || !email || email === from.email.toLowerCase() || seen.has(email)) {
        return false;
      }
      seen.add(email);
      return true;
    });
  return { participants: { from, to }, reason: null };
}

function visibleGmailSubject() {
  const subject = document.querySelector("h2.hP")?.textContent?.trim() ?? "";
  return subject ? subject.slice(0, 500) : null;
}

function starVisibleGmailThread(expectedThreadRef) {
  const currentThreadRef = parseGmailUrl(window.location.href)?.threadRef ?? null;
  if (!currentThreadRef || currentThreadRef !== expectedThreadRef) {
    return { ok: false, reason: "thread_mismatch", threadRef: currentThreadRef };
  }
  const latest = latestVisibleGmailMessage();
  if (!latest) return { ok: false, reason: "latest_visible_message_not_found", threadRef: currentThreadRef };
  const controls = Array.from(latest.querySelectorAll("[aria-label], [data-tooltip], [title]"));
  const label = (control) => [
    control.getAttribute?.("aria-label"),
    control.getAttribute?.("data-tooltip"),
    control.getAttribute?.("title"),
  ].filter(Boolean).join(" ").toLowerCase();
  const star = controls.find((control) => /add star|not starred/.test(label(control)));
  if (star && typeof star.click === "function") {
    star.click();
    return { alreadyStarred: false, ok: true, threadRef: currentThreadRef };
  }
  if (controls.some((control) => /remove star|\bstarred\b/.test(label(control)))) {
    return { alreadyStarred: true, ok: true, threadRef: currentThreadRef };
  }
  return { ok: false, reason: "star_control_not_found", threadRef: currentThreadRef };
}

function unstarVisibleGmailThread(expectedThreadRef) {
  const currentThreadRef = parseGmailUrl(window.location.href)?.threadRef ?? null;
  if (!currentThreadRef || currentThreadRef !== expectedThreadRef) {
    return { ok: false, reason: "thread_mismatch", threadRef: currentThreadRef };
  }
  const latest = latestVisibleGmailMessage();
  if (!latest) return { ok: false, reason: "latest_visible_message_not_found", threadRef: currentThreadRef };
  const controls = Array.from(latest.querySelectorAll("[aria-label], [data-tooltip], [title]"));
  const label = (control) => [
    control.getAttribute?.("aria-label"),
    control.getAttribute?.("data-tooltip"),
    control.getAttribute?.("title"),
  ].filter(Boolean).join(" ").toLowerCase();
  const unstar = controls.find((control) => {
    const value = label(control);
    return !/add star|not starred/.test(value) && /remove star|\bstarred\b/.test(value);
  });
  if (unstar && typeof unstar.click === "function") {
    unstar.click();
    return { alreadyUnstarred: false, ok: true, threadRef: currentThreadRef };
  }
  if (controls.some((control) => /add star|not starred/.test(label(control)))) {
    return { alreadyUnstarred: true, ok: true, threadRef: currentThreadRef };
  }
  return { ok: false, reason: "star_control_not_found", threadRef: currentThreadRef };
}

if (window.location.hostname === "mail.google.com") {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === STAR_VISIBLE_GMAIL_THREAD) {
      sendResponse(starVisibleGmailThread(message.threadRef));
      return false;
    }
    if (message?.type === UNSTAR_VISIBLE_GMAIL_THREAD) {
      sendResponse(unstarVisibleGmailThread(message.threadRef));
      return false;
    }
    if (message?.type !== GET_VISIBLE_GMAIL_PARTICIPANTS) return false;
    const currentThreadRef = parseGmailUrl(window.location.href)?.threadRef ?? null;
    const extraction = latestGmailParticipants();
    const latest = latestVisibleGmailMessage();
    const gmailApiThreadId = visibleGmailApiThreadId(latest);
    const subject = visibleGmailSubject();
    sendResponse({
      gmailApiThreadId,
      gmailParticipants: extraction.participants,
      gmailSubject: subject,
      participants: extraction.participants,
      subject,
      threadRef: currentThreadRef,
    });
    return false;
  });
} else {
  document.addEventListener("drop", (event) => {
    if (!event.dataTransfer) return;
    const transferredAttachment = gmailUrlFromTransfer(event.dataTransfer);
    if (!transferredAttachment) return;
    const row = event.target instanceof Element
      ? event.target.closest("[data-play-row-id]")
      : null;
    const playId = row?.getAttribute("data-play-row-id");
    if (!playId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const correlationId = crypto.randomUUID();
    const dispatchAttachment = (response, messagingFailure = null) => {
      const returnedThreadRef = response?.threadRef ?? response?.returnedThreadRef ?? null;
      const subject = response?.subject ?? response?.gmailSubject ?? null;
      const participants = response?.participants ?? response?.gmailParticipants ?? null;
      const gmailApiThreadId = response?.gmailApiThreadId ?? null;
      console.info("GMAIL_ROW_CREATE_TAB_METADATA", {
        fromPresent: Boolean(participants?.from),
        gmailThreadRef: returnedThreadRef,
        subject,
        subjectPresent: Boolean(subject?.trim?.()),
        toCount: Array.isArray(participants?.to)
          ? participants.to.length
          : 0,
      });
      if (returnedThreadRef !== transferredAttachment.threadRef || !subject?.trim?.()) {
        const reason = returnedThreadRef !== transferredAttachment.threadRef
          ? "thread_mismatch"
          : "subject_missing";
        console.warn("GMAIL_ROW_CREATE_FAILED", {
          correlationId,
          reason,
          targetPlayId: playId,
        });
        window.dispatchEvent(new CustomEvent("carnival:gmail-row-create-metadata-failed", {
          detail: JSON.stringify({
            code: messagingFailure?.code,
            correlationId,
            message: messagingFailure?.message,
            reason,
            targetPlayId: playId,
          }),
        }));
        return;
      }
      window.dispatchEvent(new CustomEvent("carnival:gmail-row-create", {
        detail: JSON.stringify({
          correlationId,
          gmailApiThreadId: gmailApiThreadId ?? undefined,
          gmailParticipants: participants ?? undefined,
          subject,
          targetPlayId: playId,
          url: transferredAttachment.canonicalUrl,
        }),
      }));
    };
    console.info("GMAIL_URL_DROP_RECEIVED", {
      accountIndex: transferredAttachment.accountIndex,
      correlationId,
      droppedThreadRef: transferredAttachment.threadRef,
    });
    console.info("GMAIL_ROW_CREATE_DROP", {
      correlationId,
      gmailThreadRef: transferredAttachment.threadRef,
      targetPlayId: playId,
    });
    sendGmailExtensionMessage({
      accountIndex: transferredAttachment.accountIndex,
      canonicalUrl: transferredAttachment.canonicalUrl,
      correlationId,
      threadRef: transferredAttachment.threadRef,
      type: GET_GMAIL_THREAD_PARTICIPANTS,
    }).then((result) => {
      if (!result.ok) {
        gmailExtensionMessaging?.reportFailureOnce?.("Gmail metadata unavailable", result);
        dispatchAttachment(null, result);
        return;
      }
      dispatchAttachment(result.response);
    }).catch(() => dispatchAttachment(null, bridgeHandlerFailure()));
  }, true);

  window.addEventListener("carnival:gmail-star-thread", (event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch {
      return;
    }
    sendGmailExtensionMessage({ ...request, type: STAR_GMAIL_THREAD })
      .then((result) => window.dispatchEvent(new CustomEvent(
        "carnival:gmail-star-result",
        { detail: JSON.stringify(result.ok
          ? { ...result.response, correlationId: request.correlationId }
          : { ...result, correlationId: request.correlationId, reason: result.code }) },
      ))).catch(() => window.dispatchEvent(new CustomEvent("carnival:gmail-star-result", {
        detail: JSON.stringify({
          ...bridgeHandlerFailure(),
          correlationId: request.correlationId,
          reason: "BRIDGE_HANDLER_FAILED",
        }),
      })));
  });

  window.addEventListener("carnival:gmail-unstar-thread", (event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch {
      return;
    }
    sendGmailExtensionMessage({ ...request, type: UNSTAR_GMAIL_THREAD })
      .then((result) => window.dispatchEvent(new CustomEvent(
        "carnival:gmail-unstar-result",
        { detail: JSON.stringify(result.ok
          ? { ...request, ...result.response }
          : { ...request, ...result, reason: result.code }) },
      ))).catch(() => window.dispatchEvent(new CustomEvent("carnival:gmail-unstar-result", {
        detail: JSON.stringify({
          ...request,
          ...bridgeHandlerFailure(),
          reason: "BRIDGE_HANDLER_FAILED",
        }),
      })));
  });
}
