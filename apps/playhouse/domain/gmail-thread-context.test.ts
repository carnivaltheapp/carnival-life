import { describe, expect, it } from "vitest";
import { gmailPlayTypeForDirection, resolveGmailCounterparty } from "./gmail-thread-context";

const kayla = { email: "kayla@example.com", name: "Kayla" };
const self = { email: "me@example.com", name: "Me" };

describe("Gmail latest-message direction", () => {
  it("maps outgoing to the first non-self recipient", () => {
    expect(resolveGmailCounterparty({
      from: self,
      lastMessageAt: "2",
      to: [self, kayla, { email: "david@example.com", name: "David" }],
    }, [self.email]))
      .toEqual({ counterparty: kayla, direction: "outgoing" });
  });
  it("maps incoming to the sender and never selects self", () => {
    expect(resolveGmailCounterparty({ from: kayla, lastMessageAt: "2", to: [self] }, [self.email]))
      .toEqual({ counterparty: kayla, direction: "incoming" });
    expect(resolveGmailCounterparty({ from: self, lastMessageAt: "2", to: [self] }, [self.email]))
      .toBeNull();
  });
  it("maps incoming to Headline and outgoing to Reminder", () => {
    expect(gmailPlayTypeForDirection("incoming")).toBe("normal");
    expect(gmailPlayTypeForDirection("outgoing")).toBe("reminder");
  });
});
