import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../supabase/database.types";
import { upsertSelectedContactReference } from "./contact-reference";
import { resolveGmailAssignee, type GmailAssigneeAccount } from "./gmail-assignee";
import { getLatestGmailMessageParticipants } from "./gmail";
import { searchPeopleForAccount } from "./people.server";
import { GOOGLE_CONTACTS_READONLY_SCOPE, GOOGLE_GMAIL_MODIFY_SCOPE } from "./scopes";
import { getGoogleAccessToken } from "./token-broker.server";

export async function resolveGmailAssigneeForThread({
  accountIndex,
  authenticatedEmail,
  ownerUserId,
  supabase,
  threadId,
}: {
  accountIndex: number;
  authenticatedEmail: string | null;
  ownerUserId: string;
  supabase: SupabaseClient<Database>;
  threadId: string;
}) {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("id, email, connection_status, granted_scopes")
    .eq("owner_user_id", ownerUserId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("Connected Google accounts could not be loaded.");

  const connected = (data ?? []).filter((account) =>
    account.connection_status === "connected" &&
    account.granted_scopes.includes(GOOGLE_GMAIL_MODIFY_SCOPE)
  );
  const preferred = connected[accountIndex];
  const ordered = preferred
    ? [preferred, ...connected.filter(({ id }) => id !== preferred.id)]
    : connected;
  const accounts: GmailAssigneeAccount[] = ordered.map(({ email, id }) => ({ email, id }));
  const accountById = new Map(ordered.map((account) => [account.id, account]));
  const selfEmails = [authenticatedEmail, ...(data ?? []).map(({ email }) => email)]
    .filter((email): email is string => Boolean(email));

  return resolveGmailAssignee({
    accounts,
    selfEmails,
    loadLatestMessage: async (account) => getLatestGmailMessageParticipants({
      accessToken: await getGoogleAccessToken({
        googleAccountId: account.id,
        ownerUserId,
      }),
      threadId,
    }),
    findExistingContact: async (email) => {
      const { data: contacts, error: contactError } = await supabase
        .from("contact_references")
        .select("id, display_name, email, provider_resource_name")
        .eq("owner_user_id", ownerUserId)
        .eq("is_self", false)
        .ilike("email", email)
        .limit(10);
      if (contactError) throw new Error("Player references could not be searched.");
      const normalized = email.trim().toLocaleLowerCase();
      const contact = (contacts ?? []).find((candidate) =>
        candidate.email?.trim().toLocaleLowerCase() === normalized &&
        Boolean(candidate.provider_resource_name)
      );
      return contact?.provider_resource_name
        ? {
            displayName: contact.display_name,
            id: contact.id,
            providerResourceName: contact.provider_resource_name,
          }
        : null;
    },
    searchGoogleContacts: async (account, email) => {
      if (!accountById.get(account.id)?.granted_scopes.includes(GOOGLE_CONTACTS_READONLY_SCOPE)) {
        return [];
      }
      return searchPeopleForAccount({
        googleAccountId: account.id,
        ownerUserId,
        query: email,
      });
    },
    persistGoogleContact: async (account, contact) => upsertSelectedContactReference({
      contact,
      googleAccountId: account.id,
      ownerUserId,
      persist: async (values) => {
        const { data: saved, error: saveError } = await supabase
          .from("contact_references")
          .upsert(values, { onConflict: "google_account_id,provider_resource_name" })
          .select("id, display_name, provider_resource_name")
          .single();
        if (saveError || !saved.provider_resource_name) {
          throw new Error("Player reference could not be saved.");
        }
        return {
          displayName: saved.display_name,
          id: saved.id,
          providerResourceName: saved.provider_resource_name,
        };
      },
    }),
  });
}
