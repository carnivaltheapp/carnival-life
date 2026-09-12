import { describe, expect, it } from "vitest";

import {
  gmailMetadataWithAttachment,
  parseGmailAttachmentUrl,
} from "./gmail-attachment";

const expected = {
  accountIndex: 2,
  canonicalUrl: "https://mail.google.com/mail/u/2/#all/FMfcgzExample",
  threadRef: "FMfcgzExample",
};

describe("Gmail attachments", () => {
  it("rejects non-Gmail, insecure, malformed, and mailbox-only URLs", () => {
    expect(parseGmailAttachmentUrl("https://example.com/mail/u/0/#all/thread")).toBeNull();
    expect(parseGmailAttachmentUrl("http://mail.google.com/mail/u/0/#all/thread")).toBeNull();
    expect(parseGmailAttachmentUrl("https://mail.google.com/mail/u/0/#inbox")).toBeNull();
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
