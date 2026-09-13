import { describe, expect, it } from "vitest";

import {
  CARNIVAL_GMAIL_DRAG_TYPE,
  gmailAttachmentFromDragData,
  gmailMetadataWithoutAttachment,
  gmailMetadataWithAttachment,
  parseGmailAttachmentUrl,
  sanitizeGmailParticipants,
} from "./gmail-attachment";

function dragData(values: Record<string, string>) {
  return {
    getData: (type: string) => values[type] ?? "",
    types: Object.keys(values),
  };
}

const expected = {
  accountIndex: 2,
  canonicalUrl: "https://mail.google.com/mail/u/2/#all/FMfcgzExample",
  threadRef: "FMfcgzExample",
};

describe("Gmail URL drop payloads", () => {
  it.each([
    ["text/uri-list", "# dragged link\nhttps://mail.google.com/mail/u/2/#all/FMfcgzExample"],
    ["text/plain", "Gmail thread https://mail.google.com/mail/u/2/#all/FMfcgzExample"],
    ["text/html", '<a href="https://mail.google.com/mail/u/2/#all/FMfcgzExample">Message</a>'],
    [CARNIVAL_GMAIL_DRAG_TYPE, JSON.stringify({ url: expected.canonicalUrl })],
  ])("parses a sanitized Gmail thread from %s", (type, value) => {
    expect(gmailAttachmentFromDragData(dragData({ [type]: value }))).toEqual(expected);
  });

  it("rejects non-Gmail, insecure, malformed, and mailbox-only URLs", () => {
    expect(parseGmailAttachmentUrl("https://example.com/mail/u/0/#all/thread")).toBeNull();
    expect(parseGmailAttachmentUrl("http://mail.google.com/mail/u/0/#all/thread")).toBeNull();
    expect(parseGmailAttachmentUrl("https://mail.google.com/mail/u/0/#inbox")).toBeNull();
    expect(gmailAttachmentFromDragData(dragData({ "text/plain": "not a URL" }))).toBeNull();
  });

  it("sanitizes participant metadata returned by the Gmail tab", () => {
    expect(sanitizeGmailParticipants({
      from: { email: " KAYLA@example.com ", name: " Kayla Pouncy " },
      to: [{ email: "me@example.com", name: "Current User" }],
    })).toEqual({
      from: { email: "kayla@example.com", name: "Kayla Pouncy" },
      to: [{ email: "me@example.com", name: "Current User" }],
    });
  });

  it("uses the final Gmail hash segment when a search route contains slashes", () => {
    expect(parseGmailAttachmentUrl(
      "https://mail.google.com/mail/u/1/#search/from%3Aexample/FMsearch",
    )).toEqual({
      accountIndex: 1,
      canonicalUrl: "https://mail.google.com/mail/u/1/#all/FMsearch",
      threadRef: "FMsearch",
    });
  });

  it("replaces only the Gmail attachment while preserving unrelated metadata", () => {
    expect(gmailMetadataWithAttachment({
      external_ids: { event_id: "calendar-1", thread_id: "old-thread" },
      legacy_source: { task_type: "H" },
    }, expected)).toEqual({
      external_ids: { event_id: "calendar-1", thread_id: "FMfcgzExample" },
      gmail_attachment: {
        account_index: 2,
        canonical_url: expected.canonicalUrl,
        thread_ref: "FMfcgzExample",
      },
      legacy_source: { task_type: "H" },
    });
  });

  it("removes only Gmail linkage metadata", () => {
    expect(gmailMetadataWithoutAttachment({
      external_ids: { event_id: "calendar-1", thread_id: "FMthread" },
      gmail_attachment: { account_index: 2, thread_ref: "FMthread" },
      legacy_source: { note: "Keep", thread_id: "legacy-thread" },
      migration: { batch_id: "batch-1" },
    })).toEqual({
      external_ids: { event_id: "calendar-1" },
      legacy_source: { note: "Keep" },
      migration: { batch_id: "batch-1" },
    });
  });
});
