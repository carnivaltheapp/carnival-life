import { describe, expect, it } from "vitest";

import {
  gmailMutationToken,
  observeGmailMutation,
} from "./gmail-live-refresh";

describe("Gmail live refresh", () => {
  it("establishes a baseline without refreshing", () => {
    expect(observeGmailMutation(null, "mutation-1")).toEqual({
      refresh: false,
      token: "mutation-1",
    });
  });

  it("refreshes once when an external Gmail mutation changes the token", () => {
    expect(observeGmailMutation("mutation-1", "mutation-2")).toEqual({
      refresh: true,
      token: "mutation-2",
    });
    expect(observeGmailMutation("mutation-2", "mutation-2")).toEqual({
      refresh: false,
      token: "mutation-2",
    });
  });

  it("accepts only one safe diagnostic id as the token", () => {
    expect(gmailMutationToken({ diagnostics: [{ id: "mutation-2" }] })).toBe("mutation-2");
    expect(gmailMutationToken({ diagnostics: [] })).toBeNull();
    expect(gmailMutationToken({ diagnostics: [{ id: 42 }] })).toBeNull();
  });
});
