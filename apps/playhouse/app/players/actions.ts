"use server";

import type {
  PlayerSearchResponse,
  PlayerSelectionResponse,
} from "../../domain/player-search";
import { upsertSelectedContactReference } from "../../lib/google/contact-reference";
import {
  canSearchGooglePeople,
  normalizePlayerSearchQuery,
} from "../../lib/google/people";
import {
  resolvePersonForAccount,
  searchPeopleForAccount,
} from "../../lib/google/people.server";
import {
  PLAYER_RECONNECT_MESSAGE,
  playerSearchErrorMessage,
} from "../../lib/google/player-search-error";
import { createClient } from "../../lib/supabase/server";

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
  if (!/^people\/[A-Za-z0-9_-]+$/.test(resourceName)) {
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
