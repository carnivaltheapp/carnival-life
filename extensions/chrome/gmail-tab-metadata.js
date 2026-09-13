export function gmailTabIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "mail.google.com") return null;
    const account = /^\/mail\/u\/(\d+)\/?$/.exec(url.pathname);
    const threadRef = decodeURIComponent(url.hash.slice(1).split("/").at(-1) ?? "").trim();
    if (!account || !threadRef) return null;
    return { accountIndex: Number(account[1]), threadRef };
  } catch {
    return null;
  }
}

export function selectGmailMetadataTab(tabs, { accountIndex, threadRef }) {
  return tabs
    .filter((tab) => {
      const identity = typeof tab.url === "string" ? gmailTabIdentity(tab.url) : null;
      return Number.isInteger(tab.id) &&
        identity?.accountIndex === accountIndex &&
        identity.threadRef === threadRef;
    })
    .sort((left, right) => Number(Boolean(right.active)) - Number(Boolean(left.active)))[0] ?? null;
}

export function verifyVisibleGmailParticipants(response, expectedThreadRef) {
  if (response?.threadRef !== expectedThreadRef) {
    return { gmailParticipants: null, status: "thread_mismatch" };
  }
  if (!response.gmailParticipants?.from) {
    return { gmailParticipants: null, status: "participants_unavailable" };
  }
  return { gmailParticipants: response.gmailParticipants, status: "resolved" };
}
