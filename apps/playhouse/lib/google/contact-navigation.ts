const GOOGLE_PERSON_RESOURCE = /^people\/([A-Za-z0-9_-]+)$/;

export function googleContactUrl(resourceName: string) {
  const personId = GOOGLE_PERSON_RESOURCE.exec(resourceName)?.[1];
  return personId
    ? `https://contacts.google.com/person/${encodeURIComponent(personId)}`
    : null;
}
