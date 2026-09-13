import { describe, expect, it } from "vitest";

import type { PlayListItem } from "./play";
import {
  claimGmailRowCreate,
  gmailRowCreateInput,
  parseGmailRowCreateRequest,
} from "./gmail-row-create";

const base = {
  correlationId: "drop-1",
  subject: "Quarterly planning",
  targetPlayId: "target-1",
  url: "https://mail.google.com/mail/u/2/#inbox/FMfcExact",
};

function target(overrides: Partial<PlayListItem> = {}): PlayListItem {
  return {
    basketId: null,
    branch: null,
    durationMinutes: 30,
    id: "target-1",
    nextPlayId: null,
    note: null,
    place: "Office",
    playerContactId: null,
    playerDisplayName: null,
    playType: "normal",
    pushRule: "weekdays",
    scheduledDate: "2026-09-14",
    sourceType: "user",
    title: "Template",
    url: null,
    ...overrides,
  };
}

describe("Gmail row-create input", () => {
  it("inherits a Headline target's date and rank but always uses Everyday Push", () => {
    const parsed = parseGmailRowCreateRequest(base);
    expect(parsed).not.toBeNull();
    expect(gmailRowCreateInput(parsed!, target())).toMatchObject({
      placement: { kind: "calendar", scheduledDate: "2026-09-14" },
      playType: "normal",
      pushRule: "everyday",
      title: "Quarterly planning",
    });
  });

  it("inherits a Reminder target's Basket and rank", () => {
    const parsed = parseGmailRowCreateRequest({
      ...base,
      gmailParticipants: {
        from: { email: "sender@example.com", name: "Sender" },
        to: [{ email: "owner@example.com", name: "Owner" }],
      },
    });
    expect(parsed).toMatchObject({
      gmailParticipants: { from: { email: "sender@example.com", name: "Sender" } },
    });
    expect(gmailRowCreateInput(parsed!, target({
      basketId: "11111111-1111-4111-8111-111111111111",
      playType: "reminder",
      scheduledDate: null,
    }))).toMatchObject({
      placement: { basketId: "11111111-1111-4111-8111-111111111111", kind: "basket" },
      playType: "reminder",
      pushRule: "everyday",
    });
  });

  it.each([
    [{ ...base, subject: "" }],
    [{ ...base, targetPlayId: "" }],
    [{ ...base, url: "https://example.com/not-gmail" }],
  ])("rejects missing required metadata", (request) => {
    expect(parseGmailRowCreateRequest(request)).toBeNull();
  });

  it("rejects an Appointment or malformed target placement", () => {
    const parsed = parseGmailRowCreateRequest(base)!;
    expect(gmailRowCreateInput(parsed, target({ legacyTaskType: "A" }))).toBeNull();
    expect(gmailRowCreateInput(parsed, target({ scheduledDate: null }))).toBeNull();
  });

  it("claims one correlation ID only once", () => {
    const processed = new Set<string>();
    expect(claimGmailRowCreate(processed, "drop-1")).toBe(true);
    expect(claimGmailRowCreate(processed, "drop-1")).toBe(false);
  });
});
