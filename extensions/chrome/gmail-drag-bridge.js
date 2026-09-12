const CARNIVAL_GMAIL_DRAG_TYPE = "application/x-carnival-gmail";
const GMAIL_DRAG_STARTED = "gmailDragStarted";
const GET_PENDING_GMAIL_DRAG = "getPendingGmailDrag";

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

  function clearPreparedDrag() {
    if (!preparedDrag) return;
    if (preparedDrag.previousDraggable === null) {
      preparedDrag.surface.removeAttribute("draggable");
    } else {
      preparedDrag.surface.setAttribute("draggable", preparedDrag.previousDraggable);
    }
    preparedDrag = null;
  }

  console.info("GMAIL_CONTENT_SCRIPT_LOADED", { gmailHost: "mail.google.com" });

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    console.info("GMAIL_POINTER_DOWN", { gmailHost: "mail.google.com" });
    clearPreparedDrag();
    const attachment = parseGmailUrl(window.location.href);
    const surface = event.target instanceof Element
      ? event.target.closest("[data-message-id], tr[role='main']")
      : null;
    if (!attachment || !surface) return;
    const threadContext = latestGmailThreadContext();
    preparedDrag = {
      attachment,
      previousDraggable: surface.getAttribute("draggable"),
      surface,
      threadContext,
    };
    surface.setAttribute("draggable", "true");
    console.info("GMAIL_DRAG_CONTEXT_RESOLVED", {
      gmailAccountIndex: attachment.accountIndex,
      gmailThreadRef: attachment.threadRef,
      hasThreadContext: Boolean(threadContext),
    });
  }, true);

  document.addEventListener("dragstart", (event) => {
    console.info("GMAIL_NATIVE_DRAGSTART", { gmailHost: "mail.google.com" });
    if (!event.dataTransfer) return;
    const attachment = preparedDrag?.attachment ??
      gmailUrlFromTransfer(event.dataTransfer) ??
      parseGmailUrl(window.location.href);
    if (!attachment) return;
    const correlationId = crypto.randomUUID();
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
      event.dataTransfer.effectAllowed = "move";
    } catch {}
    console.info("GMAIL_DRAG_PAYLOAD_SET", {
      correlationId,
      types: Array.from(event.dataTransfer.types),
    });
    console.info("GMAIL_DRAG_STARTED", {
      correlationId,
      gmailAccountIndex: attachment.accountIndex,
      gmailHost: "mail.google.com",
      gmailThreadRef: attachment.threadRef,
    });
    console.info("GMAIL_DRAG_PAYLOAD", {
      correlationId,
      types: Array.from(event.dataTransfer.types),
    });
    chrome.runtime.sendMessage({
      attachment: { ...attachment, threadContext },
      correlationId,
      type: GMAIL_DRAG_STARTED,
    }).catch(() => {});
  }, true);
  document.addEventListener("dragend", clearPreparedDrag, true);
  document.addEventListener("pointercancel", clearPreparedDrag, true);
  document.addEventListener("pointerup", clearPreparedDrag, true);
} else {
  document.addEventListener("drop", (event) => {
    if (!event.dataTransfer || gmailUrlFromTransfer(event.dataTransfer)) return;
    const row = event.target instanceof Element
      ? event.target.closest("[data-play-row-id]")
      : null;
    const playId = row?.getAttribute("data-play-row-id");
    if (!playId) return;
    console.info("GMAIL_DRAG_PAYLOAD_MISSING", { playId });
    chrome.runtime.sendMessage({ type: GET_PENDING_GMAIL_DRAG }).then((response) => {
      if (!response?.attachment || !response?.correlationId) return;
      console.info("GMAIL_DRAG_ENTER_PH", {
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
    }).catch(() => {});
  }, true);
}
