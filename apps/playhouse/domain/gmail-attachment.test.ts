import { describe, expect, it } from "vitest";

import {
  CARNIVAL_GMAIL_DRAG_TYPE,
  gmailAttachmentFromDragData,
  gmailMetadataWithAttachment,
  parseGmailAttachmentUrl,
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

describe("Gmail physical drag payloads", () => {
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

  it("sanitizes optional participants carried beside a realistic Gmail web reference", () => {
    const webThreadUrl = "https://mail.google.com/mail/u/2/#all/FMfcgzQhWLFntPRFdFXdtPtlPVcJCTFC";
    expect(gmailAttachmentFromDragData(dragData({
      [CARNIVAL_GMAIL_DRAG_TYPE]: JSON.stringify({
        gmailParticipants: {
          from: { email: " KAYLA@example.com ", name: " Kayla Pouncy " },
          to: [{ email: "me@example.com", name: "Current User" }],
        },
        url: webThreadUrl,
      }),
    }))).toEqual({
      accountIndex: 2,
      canonicalUrl: webThreadUrl,
      gmailParticipants: {
        from: { email: "kayla@example.com", name: "Kayla Pouncy" },
        to: [{ email: "me@example.com", name: "Current User" }],
      },
      threadRef: "FMfcgzQhWLFntPRFdFXdtPtlPVcJCTFC",
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
});
