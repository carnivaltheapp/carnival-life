const CARNIVAL_GMAIL_DRAG_TYPE = "application/x-carnival-gmail";
const GMAIL_DRAG_STARTED = "gmailDragStarted";
const GET_PENDING_GMAIL_DRAG = "getPendingGmailDrag";
const RECORD_GMAIL_TRACE = "recordGmailTrace";

function persistGmailTrace(event, payload) {
  const gmailParticipants = payload?.gmailParticipants ?? null;
  const details = {
    correlationId: payload?.correlationId ?? null,
    gmailParticipants,
    toCount: gmailParticipants?.to?.length ?? 0,
    url: payload?.url ?? null,
  };
  console.info(event, details);
  chrome.runtime.sendMessage({ details, event, type: RECORD_GMAIL_TRACE }).catch(() => {});
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

function gmailParticipantsFromTransfer(dataTransfer) {
  try {
    const parsed = JSON.parse(dataTransfer?.getData(CARNIVAL_GMAIL_DRAG_TYPE) ?? "");
    return parsed?.gmailParticipants?.from ? parsed.gmailParticipants : null;
  } catch {
    return null;
  }
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

function latestGmailParticipants() {
  const latest = Array.from(document.querySelectorAll("[data-message-id]")).at(-1);
  if (!latest) return null;
  const from = gmailParticipant(latest.querySelector(".gD[email], [data-hovercard-id*='@']"));
  if (!from) return null;
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
  return { from, to };
}

if (window.location.hostname === "mail.google.com") {
  document.addEventListener("dragstart", (event) => {
    if (!event.dataTransfer) return;
    const attachment = gmailUrlFromTransfer(event.dataTransfer) ??
      parseGmailUrl(window.location.href);
    if (!attachment) return;
    const correlationId = crypto.randomUUID();
    const gmailParticipants = latestGmailParticipants();
    const payload = {
      ...attachment,
      correlationId,
      gmailParticipants,
      url: attachment.canonicalUrl,
    };
    persistGmailTrace("GMAIL_SOURCE_STRUCTURED_PAYLOAD", payload);
    try {
      event.dataTransfer.setData(CARNIVAL_GMAIL_DRAG_TYPE, JSON.stringify(payload));
    } catch {}
    try {
      event.dataTransfer.setData("text/uri-list", attachment.canonicalUrl);
    } catch {}
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
    console.info("GMAIL_PARTICIPANTS_CAPTURED", {
      correlationId,
      fromExists: Boolean(gmailParticipants?.from),
      toCount: gmailParticipants?.to.length ?? 0,
    });
    chrome.runtime.sendMessage({
      attachment: payload,
      correlationId,
      type: GMAIL_DRAG_STARTED,
    }).catch(() => {});
  }, true);
} else {
  document.addEventListener("drop", (event) => {
    if (!event.dataTransfer) return;
    const transferredAttachment = gmailUrlFromTransfer(event.dataTransfer);
    if (transferredAttachment && gmailParticipantsFromTransfer(event.dataTransfer)) return;
    const row = event.target instanceof Element
      ? event.target.closest("[data-play-row-id]")
      : null;
    const playId = row?.getAttribute("data-play-row-id");
    if (!playId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const dispatchFallback = (response) => {
      const url = transferredAttachment?.canonicalUrl ?? response?.attachment?.canonicalUrl;
      if (!url) return;
      const correlationId = response?.correlationId ?? crypto.randomUUID();
      persistGmailTrace("GMAIL_MERGED_ATTACHMENT_PAYLOAD", {
        correlationId,
        gmailParticipants: response?.attachment?.gmailParticipants ?? null,
        url,
      });
      console.info("GMAIL_DRAG_ENTER_PH", { correlationId, playId });
      window.dispatchEvent(new CustomEvent("carnival:gmail-drop-fallback", {
        detail: JSON.stringify({
          correlationId,
          gmailParticipants: response?.attachment?.gmailParticipants,
          playId,
          url,
        }),
      }));
    };
    chrome.runtime.sendMessage({ type: GET_PENDING_GMAIL_DRAG }).then((response) => {
      persistGmailTrace("GMAIL_PENDING_PAYLOAD_RETURNED", {
        correlationId: response?.correlationId ?? null,
        gmailParticipants: response?.attachment?.gmailParticipants ?? null,
        url: response?.attachment?.canonicalUrl ?? null,
      });
      dispatchFallback(response);
    }).catch(() => dispatchFallback(null));
  }, true);
}
