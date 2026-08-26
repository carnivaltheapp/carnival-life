import "server-only";

import {
  getGoogleContact,
  searchGoogleContacts,
  type GoogleContactSummary,
  warmGoogleContactSearch,
} from "./people";
import { getGoogleAccessToken } from "./token-broker.server";

const TEST_CONTACTS: GoogleContactSummary[] = [
  {
    displayName: "David Example",
    email: "david@example.test",
    resourceName: "people/e2e-david",
  },
  {
    displayName: "Blair Example",
    email: "blair@example.test",
    resourceName: "people/e2e-blair",
  },
];
const WARMUP_TTL_MS = 5 * 60 * 1000;
const warmedAccounts = new Map<string, number>();

function isDeterministicTestAdapterEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.PLAYHOUSE_E2E_PEOPLE_ADAPTER === "deterministic"
  );
}

export async function searchPeopleForAccount({
  googleAccountId,
  ownerUserId,
  query,
}: {
  googleAccountId: string;
  ownerUserId: string;
  query: string;
}) {
  if (isDeterministicTestAdapterEnabled()) {
    const normalized = query.trim().toLocaleLowerCase();
    return TEST_CONTACTS.filter((contact) =>
      `${contact.displayName} ${contact.email ?? ""}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }

  const accessToken = await getGoogleAccessToken({
    googleAccountId,
    ownerUserId,
  });
  const warmedAt = warmedAccounts.get(googleAccountId) ?? 0;
  if (Date.now() - warmedAt >= WARMUP_TTL_MS) {
    await warmGoogleContactSearch(accessToken);
    warmedAccounts.set(googleAccountId, Date.now());
  }
  return searchGoogleContacts(accessToken, query);
}

export async function resolvePersonForAccount({
  googleAccountId,
  ownerUserId,
  resourceName,
}: {
  googleAccountId: string;
  ownerUserId: string;
  resourceName: string;
}) {
  if (isDeterministicTestAdapterEnabled()) {
    const contact = TEST_CONTACTS.find(
      (candidate) => candidate.resourceName === resourceName,
    );
    if (!contact) {
      throw new Error("Test contact was not found.");
    }
    return contact;
  }

  const accessToken = await getGoogleAccessToken({
    googleAccountId,
    ownerUserId,
  });
  return getGoogleContact(accessToken, resourceName);
}
