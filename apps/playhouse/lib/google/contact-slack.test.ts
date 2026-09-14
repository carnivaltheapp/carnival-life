import { describe, expect, it } from "vitest";

import {
  changedPlayerSlackFromFormData,
  slackFieldDisplayValue,
  usableSlackUrl,
} from "./contact-slack";
import { GOOGLE_CONTACTS_WRITE_SCOPE, GOOGLE_OAUTH_SCOPES } from "./scopes";

describe("Google Contact Slack", () => {
  it("requests exactly the approved Contacts write scope alongside existing scopes", () => {
    expect(GOOGLE_CONTACTS_WRITE_SCOPE).toBe("https://www.googleapis.com/auth/contacts");
    expect(GOOGLE_OAUTH_SCOPES).toContain(GOOGLE_CONTACTS_WRITE_SCOPE);
    expect(GOOGLE_OAUTH_SCOPES).not.toContain("https://www.googleapis.com/auth/contacts.other.readonly");
  });

  it("accepts Slack hosts and rejects unrelated URLs", () => {
    expect(usableSlackUrl("https://app.slack.com/client/T1/C1")).toBe(
      "https://app.slack.com/client/T1/C1",
    );
    expect(usableSlackUrl("https://carnival.slack.com/team/U1")).toBe(
      "https://carnival.slack.com/team/U1",
    );
    expect(usableSlackUrl("https://example.com/slack")).toBeNull();
  });

  it("submits changed and cleared Slack values through the main form only", () => {
    const changed = new FormData();
    changed.set("playerContactId", "contact-1");
    changed.set("slack", "https://app.slack.com/client/T1/C1");
    changed.set("slackConfirmed", "https://app.slack.com/client/T1/OLD");
    expect(changedPlayerSlackFromFormData(changed)).toEqual({
      playerContactId: "contact-1",
      slack: "https://app.slack.com/client/T1/C1",
    });

    changed.set("slack", "");
    expect(changedPlayerSlackFromFormData(changed)).toEqual({
      playerContactId: "contact-1",
      slack: "",
    });
  });

  it("skips People updates when Slack is unchanged or no Player is linked", () => {
    const unchanged = new FormData();
    unchanged.set("playerContactId", "contact-1");
    unchanged.set("slack", " https://app.slack.com/client/T1/C1 ");
    unchanged.set("slackConfirmed", "https://app.slack.com/client/T1/C1");
    expect(changedPlayerSlackFromFormData(unchanged)).toBeNull();
    unchanged.set("playerContactId", "");
    unchanged.set("slack", "https://app.slack.com/client/T1/NEW");
    expect(changedPlayerSlackFromFormData(unchanged)).toBeNull();
  });

  it("shows a live name normally, the raw URL while editing, and the URL fallback", () => {
    const url = "https://app.slack.com/client/T1/C1";
    expect(slackFieldDisplayValue({ editing: false, resolvedName: "#marketing", url }))
      .toBe("#marketing");
    expect(slackFieldDisplayValue({ editing: true, resolvedName: "#marketing", url }))
      .toBe(url);
    expect(slackFieldDisplayValue({ editing: false, resolvedName: null, url })).toBe(url);
  });
});
