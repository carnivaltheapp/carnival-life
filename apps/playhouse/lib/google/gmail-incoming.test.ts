import { describe, expect, it, vi } from "vitest";

import {
  getGmailMessageMetadata,
  listGmailAddedMessages,
  registerGmailMailboxWatch,
} from "./gmail-incoming";

function response(value: unknown) {
  return Promise.resolve(new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  }));
}

describe("Gmail incoming API", () => {
  it("registers an INBOX-only mailbox watch", async () => {
    const request = vi.fn(() => response({ expiration: "99", historyId: "10" }));
    await registerGmailMailboxWatch({
      accessToken: "secret",
      request: request as typeof fetch,
      topicName: "projects/project/topics/topic",
    });
    const call = request.mock.calls[0] as unknown as [URL, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({
      labelFilterBehavior: "INCLUDE",
      labelIds: ["INBOX"],
      topicName: "projects/project/topics/topic",
    });
  });

  it("paginates messageAdded history and deduplicates Gmail messages", async () => {
    const request = vi.fn()
      .mockImplementationOnce(() => response({
        history: [{ messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] }],
        historyId: "11",
        nextPageToken: "next",
      }))
      .mockImplementationOnce(() => response({
        history: [{ messagesAdded: [
          { message: { id: "m1", threadId: "t1" } },
          { message: { id: "m2", threadId: "t2" } },
        ] }],
        historyId: "12",
      }));
    await expect(listGmailAddedMessages({
      accessToken: "secret",
      request: request as typeof fetch,
      startHistoryId: "10",
    })).resolves.toEqual({
      latestHistoryId: "12",
      messages: [{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t2" }],
    });
  });

  it("fetches metadata headers without message bodies", async () => {
    const request = vi.fn(() => response({ id: "m1", threadId: "t1" }));
    await getGmailMessageMetadata({
      accessToken: "secret",
      messageId: "m1",
      request: request as typeof fetch,
    });
    const call = request.mock.calls[0] as unknown as [URL, RequestInit];
    const url = new URL(String(call[0]));
    expect(url.searchParams.get("format")).toBe("metadata");
    expect(url.searchParams.getAll("metadataHeaders")).toContain("From");
  });
});
