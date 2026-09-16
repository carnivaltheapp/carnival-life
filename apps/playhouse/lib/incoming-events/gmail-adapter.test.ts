import { describe, expect, it } from "vitest";

import { normalizeGmailIncomingMessage, type GmailMessageMetadata } from "./gmail-adapter";

function message(overrides: Partial<GmailMessageMetadata> = {}): GmailMessageMetadata {
  return {
    historyId: "12",
    id: "message-1",
    internalDate: "1789560000000",
    labelIds: ["INBOX"],
    payload: { headers: [
      { name: "From", value: "Sender <sender@example.com>" },
      { name: "Message-ID", value: "<message-1@example.com>" },
      { name: "In-Reply-To", value: "<prior@example.com>" },
      { name: "References", value: "<first@example.com> <prior@example.com>" },
    ] },
    threadId: "thread-1",
    ...overrides,
  };
}

describe("Gmail incoming adapter", () => {
  it("normalizes only safe metadata for a genuine incoming message", () => {
    const result = normalizeGmailIncomingMessage({
      accountEmail: "owner@example.com",
      gmailAccountId: "account-1",
      message: message(),
      now: new Date("2026-09-16T12:00:00.000Z"),
      ownerUserId: "owner-1",
    });
    expect(result).toMatchObject({
      actor: { email: "sender@example.com", name: "Sender" },
      externalEventId: "message-1",
      externalThreadId: "thread-1",
      source: "gmail",
      sourceMetadata: {
        gmailAccountId: "account-1",
        inReplyTo: "<prior@example.com>",
      },
    });
    expect(JSON.stringify(result)).not.toContain("body");
  });

  it.each([
    { labelIds: ["SENT"] },
    { labelIds: ["INBOX", "SENT"] },
    { labelIds: ["IMPORTANT"] },
    { payload: { headers: [{ name: "From", value: "owner@example.com" }] } },
  ])("ignores outgoing or non-inbox changes", (overrides) => {
    expect(normalizeGmailIncomingMessage({
      accountEmail: "owner@example.com",
      gmailAccountId: "account-1",
      message: message(overrides),
      ownerUserId: "owner-1",
    })).toBeNull();
  });
});
