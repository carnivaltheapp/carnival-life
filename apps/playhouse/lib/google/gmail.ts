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
