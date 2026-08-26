const PEOPLE_API_ORIGIN = "https://people.googleapis.com";
export const MIN_PLAYER_SEARCH_LENGTH = 2;

type PersonField = {
  metadata?: { primary?: boolean };
  value?: string;
};

type GooglePerson = {
  emailAddresses?: PersonField[];
  names?: Array<PersonField & { displayName?: string }>;
  resourceName?: string;
};

type SearchContactsResponse = {
  results?: Array<{ person?: GooglePerson }>;
};

export type GoogleContactSummary = {
  displayName: string;
  email: string | null;
  resourceName: string;
};

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
