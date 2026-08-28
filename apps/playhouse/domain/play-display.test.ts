import { describe, expect, it } from "vitest";

import {
  displayBranch,
  displayPlayDestination,
  gmailThreadIdFromMetadata,
  gmailThreadUrl,
  playRowLeadingLabel,
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
