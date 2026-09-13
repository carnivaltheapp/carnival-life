const GET_GMAIL_THREAD_PARTICIPANTS = "getGmailThreadParticipants";
const GET_VISIBLE_GMAIL_PARTICIPANTS = "getVisibleGmailParticipants";

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

function latestGmailParticipants() {
  const messages = Array.from(document.querySelectorAll("[data-message-id]"));
  const latest = messages.filter((message) => {
    if (message.getAttribute?.("aria-hidden") === "true") return false;
    return typeof message.getClientRects !== "function" || message.getClientRects().length > 0;
  }).at(-1);
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

if (window.location.hostname === "mail.google.com") {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== GET_VISIBLE_GMAIL_PARTICIPANTS) return false;
    const currentThreadRef = parseGmailUrl(window.location.href)?.threadRef ?? null;
    const extraction = latestGmailParticipants();
    sendResponse({
      gmailParticipants: extraction.participants,
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
    const dispatchAttachment = (gmailParticipants) => {
      window.dispatchEvent(new CustomEvent("carnival:gmail-drop-fallback", {
        detail: JSON.stringify({
          correlationId,
          gmailParticipants: gmailParticipants ?? undefined,
          playId,
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
      dispatchAttachment(response?.gmailParticipants ?? null);
    }).catch(() => dispatchAttachment(null));
  }, true);
}
