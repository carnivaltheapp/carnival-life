import type { GmailThreadContext } from "./gmail-thread-context";

export type GmailAttachment = {
  accountIndex: number;
  canonicalUrl: string;
  threadRef: string;
  threadContext?: GmailThreadContext;
};

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
