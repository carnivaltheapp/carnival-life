export const CARNIVAL_GMAIL_DRAG_TYPE = "application/x-carnival-gmail";

export type GmailParticipant = { email: string; name: string | null };
export type GmailParticipants = {
  from: GmailParticipant;
  to: GmailParticipant[];
};

export type GmailAttachment = {
  accountIndex: number;
  canonicalUrl: string;
  gmailParticipants?: GmailParticipants;
  threadRef: string;
};

type DragData = {
  getData(type: string): string;
  types: ArrayLike<string>;
};

function gmailUrlInText(value: string) {
  const decoded = value.replaceAll("&amp;", "&");
  return decoded.match(/https:\/\/mail\.google\.com\/[^\s"'<>]+/i)?.[0] ?? null;
}

export function parseGmailAttachmentUrl(value: string): GmailAttachment | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "mail.google.com") return null;
    const accountMatch = /^\/mail\/u\/(\d+)\/?$/.exec(url.pathname);
    const hashParts = url.hash.slice(1).split("/");
    if (!accountMatch || hashParts.length < 2) return null;
    const accountIndex = Number(accountMatch[1]);
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

function attachmentFromCustomPayload(value: string) {
  try {
    const parsed = JSON.parse(value) as { gmailParticipants?: unknown; url?: unknown };
    const attachment = typeof parsed.url === "string" ? parseGmailAttachmentUrl(parsed.url) : null;
    const gmailParticipants = sanitizeGmailParticipants(parsed.gmailParticipants);
    return attachment && gmailParticipants ? { ...attachment, gmailParticipants } : attachment;
  } catch {
    return null;
  }
}

function sanitizedParticipant(value: unknown): GmailParticipant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const email = typeof candidate.email === "string"
    ? candidate.email.trim().toLocaleLowerCase().slice(0, 320)
    : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = typeof candidate.name === "string" && candidate.name.trim()
    ? candidate.name.trim().slice(0, 200)
    : null;
  return { email, name };
}

export function sanitizeGmailParticipants(value: unknown): GmailParticipants | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const from = sanitizedParticipant(candidate.from);
  if (!from) return null;
  const to = Array.isArray(candidate.to)
    ? candidate.to.flatMap((item) => {
        const participant = sanitizedParticipant(item);
        return participant ? [participant] : [];
      }).slice(0, 50)
    : [];
  return { from, to };
}

export function gmailCorrelationIdFromDragData(data: Pick<DragData, "getData">) {
  try {
    const parsed = JSON.parse(data.getData(CARNIVAL_GMAIL_DRAG_TYPE)) as {
      correlationId?: unknown;
    };
    return typeof parsed.correlationId === "string" && parsed.correlationId.length <= 100
      ? parsed.correlationId
      : null;
  } catch {
    return null;
  }
}

export function gmailAttachmentFromDragData(data: DragData) {
  const custom = attachmentFromCustomPayload(data.getData(CARNIVAL_GMAIL_DRAG_TYPE));
  if (custom) return custom;

  for (const type of ["text/uri-list", "text/plain", "text/html"]) {
    const raw = data.getData(type);
    if (!raw) continue;
    const candidates = type === "text/uri-list"
      ? raw.split(/\r?\n/).filter((line) => line && !line.startsWith("#"))
      : [gmailUrlInText(raw)];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const attachment = parseGmailAttachmentUrl(candidate);
      if (attachment) return attachment;
    }
  }
  return null;
}

export function mayContainGmailDrag(data: Pick<DragData, "types">) {
  const types = Array.from(data.types);
  return types.includes(CARNIVAL_GMAIL_DRAG_TYPE) ||
    types.includes("text/uri-list") ||
    types.includes("text/plain") ||
    types.includes("text/html");
}

export function gmailMetadataWithAttachment(
  sourceMetadata: unknown,
  attachment: GmailAttachment,
) {
  const metadata = sourceMetadata &&
      typeof sourceMetadata === "object" &&
      !Array.isArray(sourceMetadata)
    ? sourceMetadata as Record<string, unknown>
    : {};
  const externalIds = metadata.external_ids &&
      typeof metadata.external_ids === "object" &&
      !Array.isArray(metadata.external_ids)
    ? metadata.external_ids as Record<string, unknown>
    : {};
  return {
    ...metadata,
    external_ids: { ...externalIds, thread_id: attachment.threadRef },
    gmail_attachment: {
      account_index: attachment.accountIndex,
      canonical_url: attachment.canonicalUrl,
      thread_ref: attachment.threadRef,
    },
  };
}
