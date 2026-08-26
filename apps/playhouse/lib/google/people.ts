import type { Session, SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../supabase/database.types";

const CONTACTS_READONLY_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
const PEOPLE_API_URL = "https://people.googleapis.com/v1/people/me/connections";

type PersonField = {
  metadata?: { primary?: boolean };
  value?: string;
};

type GooglePerson = {
  emailAddresses?: PersonField[];
  names?: Array<PersonField & { displayName?: string }>;
  resourceName?: string;
};

type PeopleResponse = {
  connections?: GooglePerson[];
  nextPageToken?: string;
};

export type ImportedGoogleContact = {
  displayName: string;
  email: string | null;
  resourceName: string;
};

function primaryField<T extends PersonField>(fields: T[] | undefined) {
  return fields?.find((field) => field.metadata?.primary) ?? fields?.[0];
}

function mapPerson(person: GooglePerson): ImportedGoogleContact | null {
  const resourceName = person.resourceName?.trim();
  const email = primaryField(person.emailAddresses)?.value?.trim() || null;
  const displayName = primaryField(person.names)?.displayName?.trim() || email;

  if (!resourceName || !displayName) {
    return null;
  }

  return {
    displayName,
    email,
    resourceName,
  };
}

export async function listGoogleContacts(
  providerToken: string,
  request: typeof fetch = fetch,
): Promise<ImportedGoogleContact[]> {
  const contacts: ImportedGoogleContact[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(PEOPLE_API_URL);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("personFields", "names,emailAddresses");
    url.searchParams.set("sortOrder", "FIRST_NAME_ASCENDING");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await request(url, {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    if (!response.ok) {
      throw new Error("Google contacts could not be imported.");
    }

    const page = (await response.json()) as PeopleResponse;
    contacts.push(
      ...(page.connections ?? []).flatMap((person) => {
        const contact = mapPerson(person);
        return contact ? [contact] : [];
      }),
    );
    pageToken = page.nextPageToken;
  } while (pageToken);

  return contacts;
}

function identityText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function importGoogleContactsAfterSignIn({
  providerToken,
  session,
  supabase,
}: {
  providerToken: string;
  session: Session;
  supabase: SupabaseClient<Database>;
}) {
  const identity = session.user.identities?.find((item) => item.provider === "google");
  const identityData = identity?.identity_data ?? {};
  const providerSubject = identityText(identityData.sub) ?? identity?.id ?? null;

  if (!providerSubject) {
    return;
  }

  const { data: account, error: accountError } = await supabase
    .from("google_accounts")
    .upsert(
      {
        avatar_url: identityText(identityData.avatar_url),
        connection_status: "connected",
        display_name:
          identityText(identityData.full_name) ?? identityText(identityData.name),
        email: identityText(identityData.email) ?? session.user.email ?? null,
        granted_scopes: [CONTACTS_READONLY_SCOPE],
        owner_user_id: session.user.id,
        provider_subject: providerSubject,
        sync_error: null,
      },
      { onConflict: "owner_user_id,provider_subject" },
    )
    .select("id")
    .single();

  if (accountError || !account) {
    return;
  }

  try {
    const contacts = await listGoogleContacts(providerToken);
    if (contacts.length > 0) {
      const { error } = await supabase.from("contact_references").upsert(
        contacts.map((contact) => ({
          display_name: contact.displayName,
          email: contact.email,
          google_account_id: account.id,
          owner_user_id: session.user.id,
          provider_resource_name: contact.resourceName,
        })),
        { onConflict: "google_account_id,provider_resource_name" },
      );
      if (error) {
        throw new Error("Google contacts could not be cached.");
      }
    }

    await supabase
      .from("google_accounts")
      .update({
        connection_status: "connected",
        last_synced_at: new Date().toISOString(),
        sync_error: null,
      })
      .eq("id", account.id);
  } catch {
    await supabase
      .from("google_accounts")
      .update({
        connection_status: "error",
        sync_error: "Google contact import failed. Sign out and sign in to retry.",
      })
      .eq("id", account.id);
  }
}
