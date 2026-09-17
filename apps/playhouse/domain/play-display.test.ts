import { describe, expect, it } from "vitest";

import {
  displayBranch,
  displayPlayDestination,
  gmailAccountIndexFromMetadata,
  gmailApiThreadIdFromMetadata,
  gmailThreadIdFromMetadata,
  gmailThreadUrl,
  gmailWebThreadRefFromMetadata,
  playRowLeadingLabel,
  usablePlayUrl,
  usesDateLeadingColumn,
} from "./play-display";

const baskets = [
  { id: "basket-1", name: "Backlog", slug: "backlog", sortOrder: 10 },
];

describe("Play row display helpers", () => {
  it("removes only the exact Google Drive prefix for display", () => {
    expect(displayBranch("C:\\Google Drive\\BlueField Law\\Marketing")).toBe(
      "BlueField Law\\Marketing",
    );
    expect(displayBranch("c:\\Google Drive\\BlueField Law")).toBe(
      "c:\\Google Drive\\BlueField Law",
    );
    expect(displayBranch("BlueField Law\\Marketing")).toBe(
      "BlueField Law\\Marketing",
    );
  });

  it("keeps canonical Gmail web and API thread identifiers separate", () => {
    const metadata = {
      external_ids: { thread_id: "legacy-fallback" },
      gmail_api_thread_id: "1a0ad6003af12a6b",
      gmail_attachment: {
        api_thread_id: "1a0ad6003af12a6b",
        thread_ref: "FMfcgzQZSexact",
      },
    };
    expect(gmailWebThreadRefFromMetadata(metadata)).toBe("FMfcgzQZSexact");
    expect(gmailApiThreadIdFromMetadata(metadata)).toBe("1a0ad6003af12a6b");
    expect(gmailWebThreadRefFromMetadata({
      external_ids: { thread_id: "1a0ad6003af12a6b" },
    })).toBeNull();
    expect(gmailApiThreadIdFromMetadata({
      external_ids: { thread_id: "1a0ad6003af12a6b" },
    })).toBe("1a0ad6003af12a6b");
  });

  it("reads a usable Gmail thread ID from current migration metadata", () => {
    expect(gmailThreadIdFromMetadata({
      external_ids: { thread_id: "thread-123" },
      legacy_source: { thread_id: "legacy-fallback" },
    })).toBe("thread-123");
    expect(gmailThreadIdFromMetadata({
      external_ids: { thread_id: null },
      legacy_source: { thread_id: "legacy-fallback" },
    })).toBe("legacy-fallback");
    expect(gmailThreadIdFromMetadata({ external_ids: { thread_id: "" } })).toBeNull();
  });

  it("constructs a direct Gmail thread URL", () => {
    expect(gmailThreadUrl("thread/123")).toBe(
      "https://mail.google.com/mail/u/0/#all/thread%2F123",
    );
    expect(gmailThreadUrl("thread-123", 2)).toBe(
      "https://mail.google.com/mail/u/2/#all/thread-123",
    );
    expect(gmailAccountIndexFromMetadata({
      gmail_attachment: { account_index: 2 },
    })).toBe(2);
  });

  it("exposes only usable saved HTTP URLs for the row action", () => {
    expect(usablePlayUrl("https://example.test/path")).toBe("https://example.test/path");
    expect(usablePlayUrl("http://example.test")).toBe("http://example.test");
    expect(usablePlayUrl("javascript:alert(1)")).toBeNull();
    expect(usablePlayUrl("  ")).toBeNull();
    expect(usablePlayUrl(null)).toBeNull();
  });

  it("formats real scheduled dates from their actual calendar weekday", () => {
    expect(displayPlayDestination({ basketId: null, scheduledDate: "2026-09-07" }, baskets))
      .toBe("MON-0907");
  });

  it("replaces Player with date only for date-column views", () => {
    const play = {
      basketId: null,
      playerDisplayName: "Ada Lovelace",
      scheduledDate: "2026-09-07",
    };
    expect(playRowLeadingLabel(play, baskets, false)).toBe("Ada Lovelace");
    expect(playRowLeadingLabel(play, baskets, true)).toBe("MON-0907");
    expect(usesDateLeadingColumn({ kind: "all", key: "all" })).toBe(true);
    expect(usesDateLeadingColumn({ kind: "calendar", key: "week" })).toBe(true);
    expect(usesDateLeadingColumn({ kind: "calendar", key: "today" })).toBe(false);
    expect(usesDateLeadingColumn({ kind: "basket" })).toBe(false);
  });
});
