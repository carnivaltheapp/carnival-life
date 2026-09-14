"use server";

import type {
  PlayerSearchResponse,
  PlayerSelectionResponse,
} from "../../domain/player-search";
import { isUuid } from "../../domain/play-input";
import {
  isGooglePeopleResourceName,
  upsertSelectedContactReference,
} from "../../lib/google/contact-reference";
import {
  canSearchGooglePeople,
  GoogleContactsPermissionError,
  normalizePlayerSearchQuery,
} from "../../lib/google/people";
import { usableSlackUrl } from "../../lib/google/contact-slack";
import {
  readSlackForAccount,
  readSlackValuesForAccount,
  resolvePersonForAccount,
  searchPeopleForAccount,
  writeSlackForAccount,
} from "../../lib/google/people.server";
import {
  PLAYER_RECONNECT_MESSAGE,
  playerSearchErrorMessage,
} from "../../lib/google/player-search-error";
import { createClient } from "../../lib/supabase/server";
import { GOOGLE_CONTACTS_WRITE_SCOPE } from "../../lib/google/scopes";
import { resolveSlackNameForOwner } from "../../lib/slack/connection.server";

const SLACK_RECONNECT_MESSAGE =
  "Reconnect Google and approve Contacts access before editing Slack.";

type PlayerSlackResponse =
  | { slack: string; slackName: string | null; status: "success" }
  | { message: string; status: "error" };

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  return error || !userId ? null : { supabase, userId };
}

async function currentGoogleAccount(
  auth: NonNullable<Awaited<ReturnType<typeof authenticatedClient>>>,
) {
  const { data, error } = await auth.supabase
    .from("google_accounts")
    .select("id, connection_status")
    .eq("owner_user_id", auth.userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return error ? null : data;
}

export async function searchPlayerContacts(
  enteredQuery: string,
): Promise<PlayerSearchResponse> {
  const query = normalizePlayerSearchQuery(enteredQuery);
  if (!canSearchGooglePeople(query)) {
    return { results: [], status: "success" };
  }

  const auth = await authenticatedClient();
  if (!auth) {
    return { message: "Your session expired. Refresh and sign in again.", status: "error" };
  }

  const account = await currentGoogleAccount(auth);
  if (!account || account.connection_status === "error") {
    return { message: PLAYER_RECONNECT_MESSAGE, status: "error" };
  }

  try {
    return {
      results: await searchPeopleForAccount({
        googleAccountId: account.id,
        ownerUserId: auth.userId,
        query,
      }),
      status: "success",
    };
  } catch (error) {
    return { message: playerSearchErrorMessage(error), status: "error" };
  }
}

export async function selectPlayerContact(
  resourceName: string,
): Promise<PlayerSelectionResponse> {
  if (!isGooglePeopleResourceName(resourceName)) {
    return { message: "That Player selection is invalid.", status: "error" };
  }

  const auth = await authenticatedClient();
  if (!auth) {
    return { message: "Your session expired. Refresh and sign in again.", status: "error" };
  }

  const account = await currentGoogleAccount(auth);
  if (!account || account.connection_status === "error") {
    return { message: PLAYER_RECONNECT_MESSAGE, status: "error" };
  }

  try {
    const contact = await resolvePersonForAccount({
      googleAccountId: account.id,
      ownerUserId: auth.userId,
      resourceName,
    });
    const saved = await upsertSelectedContactReference({
      contact,
      googleAccountId: account.id,
      ownerUserId: auth.userId,
      persist: async (values) => {
        const { data, error } = await auth.supabase
          .from("contact_references")
          .upsert(values, {
            onConflict: "google_account_id,provider_resource_name",
          })
          .select("id, display_name")
          .single();
        if (error || !data) {
          throw new Error("Contact reference could not be saved.");
        }
        return data;
      },
    });

    return {
      contact: { displayName: saved.display_name, id: saved.id },
      status: "success",
    };
  } catch (error) {
    return { message: playerSearchErrorMessage(error), status: "error" };
  }
}

export async function resolvePlayerContactResourceName(
  playerContactId: string,
): Promise<
  | { resourceName: string; status: "success" }
  | { message: string; status: "error" }
> {
  if (!isUuid(playerContactId)) {
    return { message: "That Player selection is invalid.", status: "error" };
  }

  const auth = await authenticatedClient();
  if (!auth) {
    return { message: "Your session expired. Refresh and sign in again.", status: "error" };
  }

  const { data, error } = await auth.supabase
    .from("contact_references")
    .select("provider_resource_name")
    .eq("id", playerContactId)
    .eq("owner_user_id", auth.userId)
    .maybeSingle();
  const resourceName = data?.provider_resource_name;
  if (error || !isGooglePeopleResourceName(resourceName)) {
    return { message: "This Player cannot be opened in Google Contacts.", status: "error" };
  }

  return { resourceName, status: "success" };
}


async function ownedGoogleContact(
  auth: NonNullable<Awaited<ReturnType<typeof authenticatedClient>>>,
  playerContactId: string,
) {
  if (!isUuid(playerContactId)) return null;
  const { data, error } = await auth.supabase
    .from("contact_references")
    .select("google_account_id, provider_resource_name")
    .eq("id", playerContactId)
    .eq("owner_user_id", auth.userId)
    .maybeSingle();
  if (
    error || !data?.google_account_id ||
    !isGooglePeopleResourceName(data.provider_resource_name)
  ) return null;
  return {
    googleAccountId: data.google_account_id,
    resourceName: data.provider_resource_name,
  };
}

export async function loadPlayerSlack(
  playerContactId: string,
): Promise<PlayerSlackResponse> {
  const auth = await authenticatedClient();
  if (!auth) return { message: "Your session expired. Refresh and sign in again.", status: "error" };
  const contact = await ownedGoogleContact(auth, playerContactId);
  if (!contact) return { message: "This Player is not linked to Google Contacts.", status: "error" };
  try {
    const slack = (await readSlackForAccount({ ...contact, ownerUserId: auth.userId })).slack;
    const slackName = await resolveSlackNameForOwner(auth.userId, slack);
    return {
      slack,
      slackName,
      status: "success",
    };
  } catch {
    return { message: "Slack could not be loaded from Google Contacts.", status: "error" };
  }
}

export async function loadPlayerSlackValues(
  playerContactIds: string[],
): Promise<{
  names: Record<string, string>;
  values: Record<string, string>;
  status: "success";
} | { status: "error" }> {
  const auth = await authenticatedClient();
  if (!auth) return { status: "error" };
  const ids = [...new Set(playerContactIds.filter(isUuid))];
  if (!ids.length) return { names: {}, status: "success", values: {} };
  const { data, error } = await auth.supabase
    .from("contact_references")
    .select("google_account_id, id, provider_resource_name")
    .eq("owner_user_id", auth.userId)
    .in("id", ids);
  if (error) return { status: "error" };
  const byAccount = new Map<string, Array<{ id: string; resourceName: string }>>();
  for (const contact of data ?? []) {
    if (!contact.google_account_id || !isGooglePeopleResourceName(contact.provider_resource_name)) continue;
    const contacts = byAccount.get(contact.google_account_id) ?? [];
    contacts.push({ id: contact.id, resourceName: contact.provider_resource_name });
    byAccount.set(contact.google_account_id, contacts);
  }
  const pairs = await Promise.all([...byAccount].map(async ([googleAccountId, contacts]) => {
    try {
      const values = await readSlackValuesForAccount({
        googleAccountId,
        ownerUserId: auth.userId,
        resourceNames: contacts.map(({ resourceName }) => resourceName),
      });
      return contacts.map(({ id, resourceName }) => [id, values[resourceName] ?? ""] as const);
    } catch {
      return [];
    }
  }));
  const values = Object.fromEntries(pairs.flat());
  const names = Object.fromEntries((await Promise.all(Object.entries(values).map(async ([id, slack]) => {
    const name = await resolveSlackNameForOwner(auth.userId, slack);
    return name ? [id, name] as const : null;
  }))).filter((entry): entry is readonly [string, string] => Boolean(entry)));
  return { names, status: "success", values };
}

export async function savePlayerSlack(
  playerContactId: string,
  slack: string,
): Promise<PlayerSlackResponse> {
  const auth = await authenticatedClient();
  if (!auth) return { message: "Your session expired. Refresh and sign in again.", status: "error" };
  const contact = await ownedGoogleContact(auth, playerContactId);
  if (!contact) return { message: "This Player is not linked to Google Contacts.", status: "error" };
  if (slack.trim() && !usableSlackUrl(slack)) {
    return { message: "Enter a valid Slack URL.", status: "error" };
  }
  const { data: account, error } = await auth.supabase
    .from("google_accounts")
    .select("connection_status, granted_scopes")
    .eq("id", contact.googleAccountId)
    .eq("owner_user_id", auth.userId)
    .maybeSingle();
  if (
    error || !account || account.connection_status !== "connected" ||
    !account.granted_scopes.includes(GOOGLE_CONTACTS_WRITE_SCOPE)
  ) return { message: SLACK_RECONNECT_MESSAGE, status: "error" };
  try {
    const saved = await writeSlackForAccount({
      ...contact,
      ownerUserId: auth.userId,
      slack,
    });
    return {
      slack: saved.slack,
      slackName: await resolveSlackNameForOwner(auth.userId, saved.slack),
      status: "success",
    };
  } catch (caught) {
    return {
      message: caught instanceof GoogleContactsPermissionError
        ? SLACK_RECONNECT_MESSAGE
        : "Slack could not be updated in Google Contacts.",
      status: "error",
    };
  }
}
