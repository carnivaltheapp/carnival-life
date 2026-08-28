import { describe, expect, it } from "vitest";

import {
  displayBranch,
  gmailThreadIdFromMetadata,
  gmailThreadUrl,
} from "./play-display";

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
});
