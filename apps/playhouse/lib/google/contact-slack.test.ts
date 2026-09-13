import { describe, expect, it } from "vitest";

import { usableSlackUrl } from "./contact-slack";
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
});
