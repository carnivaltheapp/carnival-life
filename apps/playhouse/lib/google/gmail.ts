import {
  parseGmailAddressHeader,
  type GmailMessageParticipants,
} from "./gmail-assignee";

const GMAIL_API_ORIGIN = "https://gmail.googleapis.com";

export class GmailApiError extends Error {
  constructor(public readonly status: number) {
    super("The Gmail thread could not be updated.");
    this.name = "GmailApiError";
  }
}

export async function unstarGmailThread({
  accessToken,
  request = fetch,
  threadId,
}: {
  accessToken: string;
  request?: typeof fetch;
  threadId: string;
}) {
  const response = await request(
    new URL(
      `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`,
      GMAIL_API_ORIGIN,
    ),
    {
      body: JSON.stringify({ removeLabelIds: ["STARRED"] }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  if (!response.ok) throw new GmailApiError(response.status);
}

type GmailThreadMetadata = {
  messages?: Array<{
    id?: string;
    internalDate?: string;
    payload?: { headers?: Array<{ name?: string; value?: string }> };
  }>;
};

export async function getLatestGmailMessageParticipants({
  accessToken,
  request = fetch,
  threadId,
}: {
  accessToken: string;
  request?: typeof fetch;
  threadId: string;
}): Promise<GmailMessageParticipants> {
  const url = new URL(
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
    GMAIL_API_ORIGIN,
  );
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "From");
  url.searchParams.append("metadataHeaders", "To");
  const response = await request(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new GmailApiError(response.status);

  const thread = (await response.json()) as GmailThreadMetadata;
  const latest = (thread.messages ?? []).reduce<
    NonNullable<GmailThreadMetadata["messages"]>[number] | null
  >(
    (current, message) => !current || Number(message.internalDate ?? 0) >=
        Number(current.internalDate ?? 0)
      ? message
      : current,
    null,
  );
  const headers = latest?.payload?.headers ?? [];
  const header = (name: string) => headers.find(
    (candidate) => candidate.name?.toLocaleLowerCase() === name.toLocaleLowerCase(),
  )?.value ?? "";
  const from = parseGmailAddressHeader(header("From"))[0];
  const to = parseGmailAddressHeader(header("To"));
  if (!from) throw new Error("Gmail participants were unavailable.");
  return { from, to };
}
