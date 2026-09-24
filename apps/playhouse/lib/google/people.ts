const PEOPLE_API_ORIGIN = "https://people.googleapis.com";
export const MIN_PLAYER_SEARCH_LENGTH = 2;

type PersonField = {
  metadata?: { primary?: boolean };
  value?: string;
};

type GooglePerson = {
  emailAddresses?: PersonField[];
  etag?: string;
  metadata?: { sources?: unknown[] };
  names?: Array<PersonField & { displayName?: string }>;
  resourceName?: string;
  userDefined?: Array<{ key?: string; value?: string }>;
};

type SearchContactsResponse = {
  results?: Array<{ person?: GooglePerson }>;
};

type BatchGetPeopleResponse = {
  responses?: Array<{ person?: GooglePerson }>;
};

type GoogleContactGroup = {
  groupType?: string;
  memberCount?: number;
  memberResourceNames?: string[];
  name?: string;
  resourceName?: string;
};

type ContactGroupsResponse = {
  contactGroups?: GoogleContactGroup[];
  nextPageToken?: string;
};

export type GoogleContactSummary = {
  displayName: string;
  email: string | null;
  resourceName: string;
};

export type GoogleContactGroupSummary = {
  displayName: string;
  memberCount: number;
  resourceName: string;
};

export type GoogleContactSlack = {
  resourceName: string;
  slack: string;
};

export class GoogleContactsPermissionError extends Error {}

export function isGoogleContactGroupResourceName(value: unknown): value is string {
  return typeof value === "string" && /^contactGroups\/[A-Za-z0-9_-]+$/.test(value);
}

export function slackFromUserDefined(
  values: GooglePerson["userDefined"],
) {
  return values?.find(({ key }) => key === "slack")?.value?.trim() ?? "";
}

export function updateSlackUserDefined(
  values: GooglePerson["userDefined"],
  slack: string,
) {
  const preserved = (values ?? []).filter(({ key }) => key !== "slack");
  const normalized = slack.trim();
  return normalized ? [...preserved, { key: "slack", value: normalized }] : preserved;
}

function primaryField<T extends PersonField>(fields: T[] | undefined) {
  return fields?.find((field) => field.metadata?.primary) ?? fields?.[0];
}

export function mapGooglePerson(
  person: GooglePerson,
): GoogleContactSummary | null {
  const resourceName = person.resourceName?.trim();
  const email = primaryField(person.emailAddresses)?.value?.trim() || null;
  const displayName = primaryField(person.names)?.displayName?.trim() || email;

  if (!resourceName || !displayName) {
    return null;
  }

  return { displayName, email, resourceName };
}

export function normalizePlayerSearchQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

export function canSearchGooglePeople(query: string) {
  return normalizePlayerSearchQuery(query).length >= MIN_PLAYER_SEARCH_LENGTH;
}

async function googlePeopleRequest(
  url: URL,
  accessToken: string,
  request: typeof fetch,
) {
  const response = await request(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error("Google People lookup failed.");
  }
  return response;
}

export async function searchGoogleContacts(
  accessToken: string,
  query: string,
  request: typeof fetch = fetch,
): Promise<GoogleContactSummary[]> {
  const normalizedQuery = normalizePlayerSearchQuery(query);
  if (!canSearchGooglePeople(normalizedQuery)) {
    return [];
  }

  const url = new URL("/v1/people:searchContacts", PEOPLE_API_ORIGIN);
  url.searchParams.set("query", normalizedQuery);
  url.searchParams.set("readMask", "names,emailAddresses");
  url.searchParams.set("pageSize", "10");

  const response = await googlePeopleRequest(url, accessToken, request);
  const page = (await response.json()) as SearchContactsResponse;
  return (page.results ?? []).flatMap(({ person }) => {
    const contact = person ? mapGooglePerson(person) : null;
    return contact ? [contact] : [];
  });
}

function mapGoogleContactGroup(group: GoogleContactGroup): GoogleContactGroupSummary | null {
  const resourceName = group.resourceName?.trim();
  const displayName = group.name?.trim();
  if (
    group.groupType !== "USER_CONTACT_GROUP" ||
    !isGoogleContactGroupResourceName(resourceName) ||
    !displayName
  ) return null;
  return {
    displayName,
    memberCount: Number.isSafeInteger(group.memberCount) && (group.memberCount ?? -1) >= 0
      ? group.memberCount as number
      : 0,
    resourceName,
  };
}

export async function listGoogleContactGroups(
  accessToken: string,
  request: typeof fetch = fetch,
): Promise<GoogleContactGroupSummary[]> {
  const groups: GoogleContactGroupSummary[] = [];
  let pageToken = "";
  do {
    const url = new URL("/v1/contactGroups", PEOPLE_API_ORIGIN);
    url.searchParams.set("groupFields", "name,groupType,memberCount");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await googlePeopleRequest(url, accessToken, request);
    const page = (await response.json()) as ContactGroupsResponse;
    groups.push(...(page.contactGroups ?? []).flatMap((group) => {
      const mapped = mapGoogleContactGroup(group);
      return mapped ? [mapped] : [];
    }));
    pageToken = page.nextPageToken?.trim() ?? "";
  } while (pageToken);
  return groups;
}

export async function getGoogleContactGroup(
  accessToken: string,
  resourceName: string,
  request: typeof fetch = fetch,
): Promise<GoogleContactGroupSummary> {
  if (!isGoogleContactGroupResourceName(resourceName)) {
    throw new Error("Google contact group identifier is invalid.");
  }
  const url = new URL(`/v1/${resourceName}`, PEOPLE_API_ORIGIN);
  url.searchParams.set("groupFields", "name,groupType,memberCount");
  url.searchParams.set("maxMembers", "0");
  const response = await googlePeopleRequest(url, accessToken, request);
  const group = mapGoogleContactGroup((await response.json()) as GoogleContactGroup);
  if (!group || group.resourceName !== resourceName) {
    throw new Error("Google contact group could not be verified.");
  }
  return group;
}

export async function getGoogleContactGroupMembers(
  accessToken: string,
  resourceName: string,
  request: typeof fetch = fetch,
): Promise<GoogleContactSummary[]> {
  if (!isGoogleContactGroupResourceName(resourceName)) {
    throw new Error("Google contact group identifier is invalid.");
  }
  const groupUrl = new URL(`/v1/${resourceName}`, PEOPLE_API_ORIGIN);
  groupUrl.searchParams.set("groupFields", "name,groupType,memberCount");
  groupUrl.searchParams.set("maxMembers", "1000");
  const groupResponse = await googlePeopleRequest(groupUrl, accessToken, request);
  const group = (await groupResponse.json()) as GoogleContactGroup;
  if (group.groupType !== "USER_CONTACT_GROUP" || group.resourceName !== resourceName) {
    throw new Error("Google contact group could not be verified.");
  }
  const memberResourceNames = [...new Set(
    (group.memberResourceNames ?? []).filter((value) => /^people\/[A-Za-z0-9_-]+$/.test(value)),
  )];
  const members: GoogleContactSummary[] = [];
  for (let index = 0; index < memberResourceNames.length; index += 100) {
    const url = new URL("/v1/people:batchGet", PEOPLE_API_ORIGIN);
    for (const member of memberResourceNames.slice(index, index + 100)) {
      url.searchParams.append("resourceNames", member);
    }
    url.searchParams.set("personFields", "names,emailAddresses");
    const response = await googlePeopleRequest(url, accessToken, request);
    const page = (await response.json()) as BatchGetPeopleResponse;
    members.push(...(page.responses ?? []).flatMap(({ person }) => {
      const contact = person ? mapGooglePerson(person) : null;
      return contact ? [contact] : [];
    }));
  }
  return members;
}

export async function warmGoogleContactSearch(
  accessToken: string,
  request: typeof fetch = fetch,
) {
  const url = new URL("/v1/people:searchContacts", PEOPLE_API_ORIGIN);
  url.searchParams.set("query", "");
  url.searchParams.set("readMask", "names,emailAddresses");
  url.searchParams.set("pageSize", "1");
  await googlePeopleRequest(url, accessToken, request);
}

export async function getGoogleContact(
  accessToken: string,
  resourceName: string,
  request: typeof fetch = fetch,
): Promise<GoogleContactSummary> {
  if (!/^people\/[A-Za-z0-9_-]+$/.test(resourceName)) {
    throw new Error("Google contact identifier is invalid.");
  }

  const url = new URL(`/v1/${resourceName}`, PEOPLE_API_ORIGIN);
  url.searchParams.set("personFields", "names,emailAddresses");
  const response = await googlePeopleRequest(url, accessToken, request);
  const contact = mapGooglePerson((await response.json()) as GooglePerson);

  if (!contact || contact.resourceName !== resourceName) {
    throw new Error("Google contact could not be verified.");
  }
  return contact;
}

export async function getGoogleContactSlack(
  accessToken: string,
  resourceName: string,
  request: typeof fetch = fetch,
): Promise<GoogleContactSlack> {
  if (!/^people\/[A-Za-z0-9_-]+$/.test(resourceName)) {
    throw new Error("Google contact identifier is invalid.");
  }
  const url = new URL(`/v1/${resourceName}`, PEOPLE_API_ORIGIN);
  url.searchParams.set("personFields", "metadata,userDefined");
  const response = await googlePeopleRequest(url, accessToken, request);
  const person = (await response.json()) as GooglePerson;
  if (person.resourceName !== resourceName) {
    throw new Error("Google contact could not be verified.");
  }
  return { resourceName, slack: slackFromUserDefined(person.userDefined) };
}

export async function getGoogleContactsSlack(
  accessToken: string,
  resourceNames: string[],
  request: typeof fetch = fetch,
) {
  const validNames = [...new Set(resourceNames.filter((value) =>
    /^people\/[A-Za-z0-9_-]+$/.test(value),
  ))];
  if (!validNames.length) return {};
  const url = new URL("/v1/people:batchGet", PEOPLE_API_ORIGIN);
  for (const resourceName of validNames) url.searchParams.append("resourceNames", resourceName);
  url.searchParams.set("personFields", "userDefined");
  const response = await googlePeopleRequest(url, accessToken, request);
  const page = (await response.json()) as BatchGetPeopleResponse;
  return Object.fromEntries((page.responses ?? []).flatMap(({ person }) =>
    person?.resourceName
      ? [[person.resourceName, slackFromUserDefined(person.userDefined)]]
      : [],
  ));
}

export async function updateGoogleContactSlack(
  accessToken: string,
  resourceName: string,
  slack: string,
  request: typeof fetch = fetch,
): Promise<GoogleContactSlack> {
  if (!/^people\/[A-Za-z0-9_-]+$/.test(resourceName)) {
    throw new Error("Google contact identifier is invalid.");
  }
  const readUrl = new URL(`/v1/${resourceName}`, PEOPLE_API_ORIGIN);
  readUrl.searchParams.set("personFields", "metadata,userDefined");
  const currentResponse = await googlePeopleRequest(readUrl, accessToken, request);
  const current = (await currentResponse.json()) as GooglePerson;
  if (current.resourceName !== resourceName || !current.metadata?.sources?.length) {
    throw new Error("Google contact could not be updated safely.");
  }

  const updateUrl = new URL(`/v1/${resourceName}:updateContact`, PEOPLE_API_ORIGIN);
  updateUrl.searchParams.set("updatePersonFields", "userDefined");
  updateUrl.searchParams.set("personFields", "metadata,userDefined");
  const response = await request(updateUrl, {
    body: JSON.stringify({
      etag: current.etag,
      metadata: { sources: current.metadata.sources },
      resourceName,
      userDefined: updateSlackUserDefined(current.userDefined, slack),
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  if (response.status === 401 || response.status === 403) {
    throw new GoogleContactsPermissionError("Google Contacts permission is required.");
  }
  if (!response.ok) throw new Error("Google contact update failed.");
  const updated = (await response.json()) as GooglePerson;
  return { resourceName, slack: slackFromUserDefined(updated.userDefined) };
}
