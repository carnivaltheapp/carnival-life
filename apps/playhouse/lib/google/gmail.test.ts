import { describe, expect, it, vi } from "vitest";

import { GmailApiError, unstarGmailThread } from "./gmail";
import { GOOGLE_GMAIL_MODIFY_SCOPE, GOOGLE_OAUTH_SCOPES } from "./scopes";

describe("Gmail thread labels", () => {
  it("requests Gmail modify consent", () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain(GOOGLE_GMAIL_MODIFY_SCOPE);
  });

  it("removes only STARRED from the encoded Gmail thread", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));

    await unstarGmailThread({
      accessToken: "server-access-token",
      request,
      threadId: "thread/123",
    });

    const [requestUrl, init] = request.mock.calls[0];
    expect((requestUrl as URL).toString()).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/threads/thread%2F123/modify",
    );
    expect(init).toMatchObject({
      body: JSON.stringify({ removeLabelIds: ["STARRED"] }),
      method: "POST",
    });
    expect(init?.headers).toEqual({
      Authorization: "Bearer server-access-token",
      "Content-Type": "application/json",
    });
  });

  it("surfaces a secret-safe API error", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("forbidden", { status: 403 }),
    );

    await expect(unstarGmailThread({
      accessToken: "server-access-token",
      request,
      threadId: "thread-1",
    })).rejects.toEqual(new GmailApiError(403));
  });
});
