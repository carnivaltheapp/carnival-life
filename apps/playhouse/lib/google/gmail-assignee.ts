import type { GoogleContactSummary } from "./people";

export type GmailParticipant = {
  email: string;
  name: string | null;
};

export type GmailMessageParticipants = {
  from: GmailParticipant;
  to: GmailParticipant[];
};

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

export function parseGmailAddressHeader(value: string): GmailParticipant[] {
  const participants: GmailParticipant[] = [];
  const addressPattern = /(?:(?:"([^"]*)"|([^,<]*?))\s*<)?([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/gi;
  for (const match of value.matchAll(addressPattern)) {
    const email = normalizeEmail(match[3] ?? "");
    if (!email) continue;
    const name = (match[1] ?? match[2] ?? "")
      .trim()
      .replace(/^['"]|['"]$/g, "") || null;
    participants.push({ email, name });
  }
  return participants;
}

export function resolveGmailCounterparty(
  message: GmailMessageParticipants,
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
  loadLatestMessage,
  persistGoogleContact,
  searchGoogleContacts,
  selfEmails,
}: {
  accounts: GmailAssigneeAccount[];
  findExistingContact: (email: string) => Promise<GmailAssigneeContact | null>;
  loadLatestMessage: (account: GmailAssigneeAccount) => Promise<GmailMessageParticipants>;
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
  let accountWithThread: GmailAssigneeAccount | null = null;
  let message: GmailMessageParticipants | null = null;
  for (const account of accounts) {
    try {
      message = await loadLatestMessage(account);
      accountWithThread = account;
      break;
    } catch {
      // A Gmail browser account index is not a durable connected-account ID.
      // Try only the authenticated user's other connected accounts.
    }
  }
  if (!accountWithThread || !message) {
    return { reason: "thread_metadata_unavailable", status: "failed" };
  }

  const counterparty = resolveGmailCounterparty(message, selfEmails);
  if (!counterparty) {
    return { reason: "counterparty_unavailable", status: "failed" };
  }

  const existing = await findExistingContact(counterparty.email);
  if (existing) {
    return { contact: existing, counterparty, source: "existing", status: "matched" };
  }

  const googleContact = exactEmailContact(
    await searchGoogleContacts(accountWithThread, counterparty.email),
    counterparty.email,
  );
  if (!googleContact) {
    return { counterparty, status: "contact_not_found" };
  }

  return {
    contact: await persistGoogleContact(accountWithThread, googleContact),
    counterparty,
    source: "google_people",
    status: "matched",
  };
}
