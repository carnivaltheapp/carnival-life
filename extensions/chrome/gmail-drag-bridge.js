const GET_GMAIL_THREAD_PARTICIPANTS = "getGmailThreadParticipants";
const GET_VISIBLE_GMAIL_PARTICIPANTS = "getVisibleGmailParticipants";
const STAR_GMAIL_THREAD = "starGmailThread";
const STAR_VISIBLE_GMAIL_THREAD = "starVisibleGmailThread";

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

if (window.location.hostname === "mail.google.com") {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === STAR_VISIBLE_GMAIL_THREAD) {
      sendResponse(starVisibleGmailThread(message.threadRef));
      return false;
    }
    if (message?.type !== GET_VISIBLE_GMAIL_PARTICIPANTS) return false;
    const currentThreadRef = parseGmailUrl(window.location.href)?.threadRef ?? null;
    const extraction = latestGmailParticipants();
    sendResponse({
      gmailParticipants: extraction.participants,
      gmailSubject: visibleGmailSubject(),
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
    const destination = event.target instanceof Element
      ? event.target.closest("[data-gmail-new-play-placement]")
      : null;
    const bullseyeActive = destination?.closest("[data-gmail-bullseye-active='true']");
    if (!playId && !bullseyeActive) return;
    let placement = null;
    if (!playId) {
      try {
        placement = JSON.parse(destination.getAttribute("data-gmail-new-play-placement"));
      } catch {
        return;
      }
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const correlationId = crypto.randomUUID();
    const dispatchAttachment = (response) => {
      const eventName = playId
        ? "carnival:gmail-drop-fallback"
        : "carnival:gmail-bullseye-drop";
      window.dispatchEvent(new CustomEvent(eventName, {
        detail: JSON.stringify({
          correlationId,
          gmailParticipants: response?.gmailParticipants ?? undefined,
          ...(playId ? { playId } : { placement, subject: response?.gmailSubject ?? undefined }),
          url: transferredAttachment.canonicalUrl,
        }),
      }));
    };
    console.info("GMAIL_URL_DROP_RECEIVED", {
      accountIndex: transferredAttachment.accountIndex,
      correlationId,
      droppedThreadRef: transferredAttachment.threadRef,
    });
    chrome.runtime.sendMessage({
      accountIndex: transferredAttachment.accountIndex,
      canonicalUrl: transferredAttachment.canonicalUrl,
      correlationId,
      threadRef: transferredAttachment.threadRef,
      type: GET_GMAIL_THREAD_PARTICIPANTS,
    }).then((response) => {
      dispatchAttachment(response);
    }).catch(() => dispatchAttachment(null));
  }, true);

  window.addEventListener("carnival:gmail-star-thread", (event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch {
      return;
    }
    chrome.runtime.sendMessage({ ...request, type: STAR_GMAIL_THREAD })
      .then((response) => window.dispatchEvent(new CustomEvent(
        "carnival:gmail-star-result",
        { detail: JSON.stringify({ ...response, correlationId: request.correlationId }) },
      )))
      .catch(() => window.dispatchEvent(new CustomEvent(
        "carnival:gmail-star-result",
        {
          detail: JSON.stringify({
            correlationId: request.correlationId,
            ok: false,
            reason: "extension_request_failed",
          }),
        },
      )));
  });
}
