import type { GmailMessageMetadata } from "../incoming-events/gmail-adapter";

const GMAIL_API_ORIGIN = "https://gmail.googleapis.com";

export class GmailIncomingApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GmailIncomingApiError";
  }
}

async function gmailJson<T>({
  accessToken,
  body,
  method = "GET",
  path,
  request = fetch,
}: {
  accessToken: string;
  body?: unknown;
  method?: "GET" | "POST";
  path: string;
  request?: typeof fetch;
}): Promise<T> {
  const response = await request(new URL(path, GMAIL_API_ORIGIN), {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    method,
  });
  if (!response.ok) {
    throw new GmailIncomingApiError("The Gmail incoming-event request failed.", response.status);
  }
  return await response.json() as T;
}

export async function registerGmailMailboxWatch({
  accessToken,
  request,
  topicName,
}: {
  accessToken: string;
  request?: typeof fetch;
  topicName: string;
}) {
  return gmailJson<{ expiration: string; historyId: string }>({
    accessToken,
    body: {
      labelFilterBehavior: "INCLUDE",
      labelIds: ["INBOX"],
      topicName,
    },
    method: "POST",
    path: "/gmail/v1/users/me/watch",
    request,
  });
}

export async function listGmailAddedMessages({
  accessToken,
  request,
  startHistoryId,
}: {
  accessToken: string;
  request?: typeof fetch;
  startHistoryId: string;
}) {
  const messages = new Map<string, { id: string; threadId: string | null }>();
  let pageToken: string | null = null;
  let latestHistoryId = startHistoryId;
  do {
    const url = new URL("/gmail/v1/users/me/history", GMAIL_API_ORIGIN);
    url.searchParams.set("historyTypes", "messageAdded");
    url.searchParams.set("labelId", "INBOX");
    url.searchParams.set("maxResults", "500");
    url.searchParams.set("startHistoryId", startHistoryId);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await gmailJson<{
      history?: Array<{
        messagesAdded?: Array<{ message?: { id?: unknown; threadId?: unknown } }>;
      }>;
      historyId?: unknown;
      nextPageToken?: unknown;
    }>({ accessToken, path: `${url.pathname}${url.search}`, request });
    for (const record of response.history ?? []) {
      for (const added of record.messagesAdded ?? []) {
        const id = typeof added.message?.id === "string" ? added.message.id : null;
        const threadId = typeof added.message?.threadId === "string"
          ? added.message.threadId
          : null;
        if (id) messages.set(id, { id, threadId });
      }
    }
    if (typeof response.historyId === "string") latestHistoryId = response.historyId;
    pageToken = typeof response.nextPageToken === "string" && response.nextPageToken
      ? response.nextPageToken
      : null;
  } while (pageToken);
  return { latestHistoryId, messages: [...messages.values()] };
}

export async function getGmailMessageMetadata({
  accessToken,
  messageId,
  request,
}: {
  accessToken: string;
  messageId: string;
  request?: typeof fetch;
}) {
  const url = new URL(
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
    GMAIL_API_ORIGIN,
  );
  url.searchParams.set("format", "metadata");
  for (const header of ["From", "To", "Message-ID", "In-Reply-To", "References"]) {
    url.searchParams.append("metadataHeaders", header);
  }
  return gmailJson<GmailMessageMetadata>({
    accessToken,
    path: `${url.pathname}${url.search}`,
    request,
  });
}
