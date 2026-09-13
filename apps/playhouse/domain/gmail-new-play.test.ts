import { describe, expect, it } from "vitest";

import { claimGmailNewPlayDrop, parseGmailNewPlayRequest } from "./gmail-new-play";

const base = {
  correlationId: "drop-1",
  placement: { kind: "calendar", scheduledDate: "2026-09-14" } as const,
  subject: "Quarterly planning",
  url: "https://mail.google.com/mail/u/2/#inbox/FMfcExact",
};

describe("Gmail Bullseye new Play input", () => {
  it("maps a calendar destination to one Headline with standard new-Play defaults", () => {
    expect(parseGmailNewPlayRequest(base)).toMatchObject({
      attachment: {
        accountIndex: 2,
        canonicalUrl: "https://mail.google.com/mail/u/2/#all/FMfcExact",
        threadRef: "FMfcExact",
      },
      correlationId: "drop-1",
      input: {
        durationMinutes: 30,
        place: "Office",
        placement: { kind: "calendar", scheduledDate: "2026-09-14" },
        playType: "normal",
        pushRule: "everyday",
        title: "Quarterly planning",
      },
    });
  });

  it("accepts a Basket and preserves sanitized participants", () => {
    expect(parseGmailNewPlayRequest({
      ...base,
      gmailParticipants: {
        from: { email: "sender@example.com", name: "Sender" },
        to: [{ email: "owner@example.com", name: "Owner" }],
      },
      placement: { basketId: "11111111-1111-4111-8111-111111111111", kind: "basket" },
    })).toMatchObject({
      gmailParticipants: {
        from: { email: "sender@example.com", name: "Sender" },
      },
      input: {
        placement: { basketId: "11111111-1111-4111-8111-111111111111", kind: "basket" },
      },
    });
  });

  it.each([
    [{ ...base, subject: "" }],
    [{ ...base, placement: { kind: "calendar", scheduledDate: "not-a-date" } }],
    [{ ...base, placement: { basketId: "not-a-basket", kind: "basket" } }],
  ])("rejects missing required metadata or an invalid destination", (request) => {
    expect(parseGmailNewPlayRequest(request)).toBeNull();
  });

  it("claims one correlation ID only once", () => {
    const processed = new Set<string>();
    expect(claimGmailNewPlayDrop(processed, "drop-1")).toBe(true);
    expect(claimGmailNewPlayDrop(processed, "drop-1")).toBe(false);
    expect(processed).toEqual(new Set(["drop-1"]));
  });
});
