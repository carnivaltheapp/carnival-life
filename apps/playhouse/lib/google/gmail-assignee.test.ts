import { describe, expect, it, vi } from "vitest";

import {
  parseGmailAddressHeader,
  resolveGmailAssignee,
  resolveGmailCounterparty,
} from "./gmail-assignee";

const self = { email: "me@example.com", name: "Me" };
const kayla = { email: "kayla@example.com", name: "Kayla Pouncy" };
const david = { email: "david@example.com", name: "David Example" };
const account = { email: self.email, id: "google-account-1" };
const existing = {
  displayName: kayla.name,
  id: "contact-kayla",
  providerResourceName: "people/kayla",
};

describe("Gmail Assignee resolution", () => {
  it("parses ordered Gmail address headers, including quoted names", () => {
    expect(parseGmailAddressHeader(
      '\"Pouncy, Kayla\" <KAYLA@example.com>, David Example <david@example.com>',
    )).toEqual([
      { email: "kayla@example.com", name: "Pouncy, Kayla" },
      david,
    ]);
  });

  it("uses the incoming sender and reuses an exact-email cached contact", async () => {
    const findExistingContact = vi.fn().mockResolvedValue(existing);
    const persistGoogleContact = vi.fn();
    await expect(resolveGmailAssignee({
      accounts: [account],
      selfEmails: [self.email],
      loadLatestMessage: vi.fn().mockResolvedValue({ from: kayla, to: [self] }),
      findExistingContact,
      searchGoogleContacts: vi.fn(),
      persistGoogleContact,
    })).resolves.toMatchObject({ contact: existing, counterparty: kayla, source: "existing" });
    expect(findExistingContact).toHaveBeenCalledWith(kayla.email);
    expect(persistGoogleContact).not.toHaveBeenCalled();
  });

  it("uses only the first non-self outgoing recipient and links an exact People match", async () => {
    const persistGoogleContact = vi.fn().mockResolvedValue(existing);
    const searchGoogleContacts = vi.fn().mockResolvedValue([
      { displayName: "Wrong", email: "other@example.com", resourceName: "people/wrong" },
      { displayName: kayla.name, email: "KAYLA@example.com", resourceName: "people/kayla" },
    ]);
    const result = await resolveGmailAssignee({
      accounts: [account],
      selfEmails: [self.email],
      loadLatestMessage: vi.fn().mockResolvedValue({ from: self, to: [self, kayla, david] }),
      findExistingContact: vi.fn().mockResolvedValue(null),
      searchGoogleContacts,
      persistGoogleContact,
    });
    expect(result).toMatchObject({ contact: existing, counterparty: kayla, source: "google_people" });
    expect(searchGoogleContacts).toHaveBeenCalledWith(account, kayla.email);
    expect(persistGoogleContact).toHaveBeenCalledWith(account, {
      displayName: kayla.name,
      email: "KAYLA@example.com",
      resourceName: "people/kayla",
    });
  });

  it("never selects self and does not create a synthetic contact", async () => {
    expect(resolveGmailCounterparty({ from: self, to: [self] }, [self.email])).toBeNull();
    const persistGoogleContact = vi.fn();
    await expect(resolveGmailAssignee({
      accounts: [account],
      selfEmails: [self.email],
      loadLatestMessage: vi.fn().mockResolvedValue({ from: kayla, to: [self] }),
      findExistingContact: vi.fn().mockResolvedValue(null),
      searchGoogleContacts: vi.fn().mockResolvedValue([]),
      persistGoogleContact,
    })).resolves.toEqual({ counterparty: kayla, status: "contact_not_found" });
    expect(persistGoogleContact).not.toHaveBeenCalled();
  });
});
