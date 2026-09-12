import type { GoogleContactSummary } from "./people";
import type { GmailParticipant, GmailParticipants } from "../../domain/gmail-attachment";

export type GmailAssigneeContact = {
  displayName: string;
  id: string;
  providerResourceName: string;
};

export type GmailAssigneeAccount = {
  email: string | null;
  id: string;
};

export type GmailAssigneeResolution =
  | {
      contact: GmailAssigneeContact;
      counterparty: GmailParticipant;
      source: "existing" | "google_people";
      status: "matched";
    }
  | {
      counterparty: GmailParticipant;
      status: "contact_not_found";
    }
  | { reason: string; status: "failed" };

export function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function resolveGmailCounterparty(
  message: GmailParticipants,
  selfEmails: string[],
) {
  const self = new Set(selfEmails.map(normalizeEmail).filter(Boolean));
  const fromIsSelf = self.has(normalizeEmail(message.from.email));
  if (fromIsSelf) {
    return message.to.find(({ email }) => !self.has(normalizeEmail(email))) ?? null;
  }
  return self.has(normalizeEmail(message.from.email)) ? null : message.from;
}

export function exactEmailContact(
  contacts: GoogleContactSummary[],
  email: string,
) {
  const normalized = normalizeEmail(email);
  return contacts.find((contact) =>
    contact.email !== null && normalizeEmail(contact.email) === normalized
  ) ?? null;
}

export async function resolveGmailAssignee({
  accounts,
  findExistingContact,
  message,
  persistGoogleContact,
  searchGoogleContacts,
  selfEmails,
}: {
  accounts: GmailAssigneeAccount[];
  findExistingContact: (email: string) => Promise<GmailAssigneeContact | null>;
  message: GmailParticipants;
  persistGoogleContact: (
    account: GmailAssigneeAccount,
    contact: GoogleContactSummary,
  ) => Promise<GmailAssigneeContact>;
  searchGoogleContacts: (
    account: GmailAssigneeAccount,
    email: string,
  ) => Promise<GoogleContactSummary[]>;
  selfEmails: string[];
}): Promise<GmailAssigneeResolution> {
  const counterparty = resolveGmailCounterparty(message, selfEmails);
  if (!counterparty) {
    return { reason: "counterparty_unavailable", status: "failed" };
  }

  const existing = await findExistingContact(counterparty.email);
  if (existing) {
    return { contact: existing, counterparty, source: "existing", status: "matched" };
  }

  const account = accounts[0];
  if (!account) return { counterparty, status: "contact_not_found" };

  const googleContact = exactEmailContact(
    await searchGoogleContacts(account, counterparty.email),
    counterparty.email,
  );
  if (!googleContact) {
    return { counterparty, status: "contact_not_found" };
  }

  return {
    contact: await persistGoogleContact(account, googleContact),
    counterparty,
    source: "google_people",
    status: "matched",
  };
}
