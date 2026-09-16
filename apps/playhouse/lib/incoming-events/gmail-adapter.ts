import type { NormalizedIncomingEvent } from "../../domain/incoming-event";

export type GmailMessageMetadata = {
  historyId?: unknown;
  id?: unknown;
  internalDate?: unknown;
  labelIds?: unknown;
  payload?: {
    headers?: unknown;
  };
  threadId?: unknown;
};

type GmailHeader = { name?: unknown; value?: unknown };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function headers(message: GmailMessageMetadata) {
  const values = Array.isArray(message.payload?.headers)
    ? message.payload.headers as GmailHeader[]
    : [];
  return new Map(values.flatMap((header) => {
    const name = text(header.name)?.toLocaleLowerCase();
    const value = text(header.value);
    return name && value ? [[name, value] as const] : [];
  }));
}

function emailAddress(value: string | null) {
  if (!value) return null;
  const bracketed = /<([^<>\s]+@[^<>\s]+)>/.exec(value)?.[1];
  const plain = /(?:^|\s)([^<>\s,;]+@[^<>\s,;]+)/.exec(value)?.[1];
  return (bracketed ?? plain ?? "").trim().toLocaleLowerCase() || null;
}

function displayName(value: string | null) {
  if (!value) return null;
  const beforeAddress = value.split("<", 1)[0]?.trim().replace(/^"|"$/g, "");
  return beforeAddress || null;
}

function referenceIds(value: string | null) {
  if (!value) return [];
  return Array.from(new Set(
    (value.match(/<[^<>]+>/g) ?? value.split(/\s+/))
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(-50),
  ));
}

export function normalizeGmailIncomingMessage({
  accountEmail,
  gmailAccountId,
  message,
  now = new Date(),
  ownerUserId,
}: {
  accountEmail: string;
  gmailAccountId: string;
  message: GmailMessageMetadata;
  now?: Date;
  ownerUserId: string;
}): NormalizedIncomingEvent | null {
  const messageId = text(message.id);
  const threadId = text(message.threadId);
  if (!messageId || !threadId) return null;
  const labelIds = Array.isArray(message.labelIds)
    ? message.labelIds.filter((label): label is string => typeof label === "string")
    : [];
  const messageHeaders = headers(message);
  const fromValue = messageHeaders.get("from") ?? null;
  const fromEmail = emailAddress(fromValue);
  const ownEmail = accountEmail.trim().toLocaleLowerCase();
  if (!labelIds.includes("INBOX") || labelIds.includes("SENT") || fromEmail === ownEmail) {
    return null;
  }
  const occurredAtValue = Number(text(message.internalDate));
  const occurredAt = Number.isFinite(occurredAtValue)
    ? new Date(occurredAtValue)
    : now;
  const internetMessageId = messageHeaders.get("message-id") ?? null;
  const inReplyTo = messageHeaders.get("in-reply-to") ?? null;
  const references = referenceIds(messageHeaders.get("references") ?? null);

  const event: NormalizedIncomingEvent = {
    actor: fromEmail
      ? { email: fromEmail, name: displayName(fromValue) ?? undefined }
      : undefined,
    eventType: "message_received",
    externalEventId: messageId,
    externalItemId: messageId,
    externalThreadId: threadId,
    occurredAt: occurredAt.toISOString(),
    ownerUserId,
    receivedAt: now.toISOString(),
    source: "gmail",
    sourceMetadata: {
      gmailAccountId,
      historyId: text(message.historyId),
      inReplyTo,
      internetMessageId,
      references,
    },
  };
  console.info("CARNIVAL_INCOMING_EVENT GMAIL_MESSAGE_NORMALIZED", {
    externalEventId: messageId,
    externalThreadId: threadId,
  });
  return event;
}
