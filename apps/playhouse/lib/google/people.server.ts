import "server-only";

import {
  createGoogleContact,
  getGoogleContact,
  getGoogleContactGroup,
  getGoogleContactGroupMembers,
  getGoogleContactSlack,
  getGoogleContactsSlack,
  searchGoogleContacts,
  listGoogleContactGroups,
  type GoogleContactSummary,
  warmGoogleContactSearch,
  updateGoogleContactSlack,
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
const TEST_GROUPS = [{
  displayName: "Carnival Friends",
  memberCount: 2,
  resourceName: "contactGroups/e2e-friends",
}];
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
    return [
      ...TEST_CONTACTS.filter((contact) =>
        `${contact.displayName} ${contact.email ?? ""}`
          .toLocaleLowerCase()
          .includes(normalized),
      ).map((contact) => ({ ...contact, kind: "contact" as const })),
      ...TEST_GROUPS.filter((group) => group.displayName.toLocaleLowerCase().includes(normalized))
        .map((group) => ({ ...group, kind: "group" as const })),
    ];
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
  const normalized = query.trim().toLocaleLowerCase();
  const [contacts, groups] = await Promise.all([
    searchGoogleContacts(accessToken, query),
    listGoogleContactGroups(accessToken),
  ]);
  return [
    ...contacts.map((contact) => ({ ...contact, kind: "contact" as const })),
    ...groups
      .filter((group) => group.displayName.toLocaleLowerCase().includes(normalized))
      .map((group) => ({ ...group, kind: "group" as const })),
  ];
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

export async function createPersonForAccount({
  email,
  googleAccountId,
  name,
  ownerUserId,
}: {
  email: string;
  googleAccountId: string;
  name: string | null;
  ownerUserId: string;
}) {
  const accessToken = await getGoogleAccessToken({ googleAccountId, ownerUserId });
  return createGoogleContact(accessToken, { email, name });
}

export async function resolveContactGroupForAccount({
  googleAccountId,
  ownerUserId,
  resourceName,
}: {
  googleAccountId: string;
  ownerUserId: string;
  resourceName: string;
}) {
  if (isDeterministicTestAdapterEnabled()) {
    const group = TEST_GROUPS.find((candidate) => candidate.resourceName === resourceName);
    if (!group) throw new Error("Test contact group was not found.");
    return group;
  }
  const accessToken = await getGoogleAccessToken({ googleAccountId, ownerUserId });
  return getGoogleContactGroup(accessToken, resourceName);
}

export async function readContactGroupMembersForAccount({
  googleAccountId,
  ownerUserId,
  resourceName,
}: {
  googleAccountId: string;
  ownerUserId: string;
  resourceName: string;
}) {
  if (isDeterministicTestAdapterEnabled()) return TEST_CONTACTS;
  const accessToken = await getGoogleAccessToken({ googleAccountId, ownerUserId });
  return getGoogleContactGroupMembers(accessToken, resourceName);
}

export async function readSlackForAccount({
  googleAccountId,
  ownerUserId,
  resourceName,
}: {
  googleAccountId: string;
  ownerUserId: string;
  resourceName: string;
}) {
  if (isDeterministicTestAdapterEnabled()) return { resourceName, slack: "" };
  const accessToken = await getGoogleAccessToken({ googleAccountId, ownerUserId });
  return getGoogleContactSlack(accessToken, resourceName);
}

export async function readSlackValuesForAccount({
  googleAccountId,
  ownerUserId,
  resourceNames,
}: {
  googleAccountId: string;
  ownerUserId: string;
  resourceNames: string[];
}) {
  if (isDeterministicTestAdapterEnabled()) return {};
  const accessToken = await getGoogleAccessToken({ googleAccountId, ownerUserId });
  const chunks: string[][] = [];
  for (let index = 0; index < resourceNames.length; index += 100) {
    chunks.push(resourceNames.slice(index, index + 100));
  }
  return Object.assign({}, ...await Promise.all(chunks.map((chunk) =>
    getGoogleContactsSlack(accessToken, chunk),
  )));
}

export async function writeSlackForAccount({
  googleAccountId,
  ownerUserId,
  resourceName,
  slack,
}: {
  googleAccountId: string;
  ownerUserId: string;
  resourceName: string;
  slack: string;
}) {
  if (isDeterministicTestAdapterEnabled()) return { resourceName, slack: slack.trim() };
  const accessToken = await getGoogleAccessToken({ googleAccountId, ownerUserId });
  return updateGoogleContactSlack(accessToken, resourceName, slack);
}
