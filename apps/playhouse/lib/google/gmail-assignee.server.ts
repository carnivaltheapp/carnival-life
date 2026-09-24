import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../supabase/database.types";
import type { GmailParticipants } from "../../domain/gmail-attachment";
import { upsertSelectedContactReference } from "./contact-reference";
import {
  exactCanonicalCachedContact,
  resolveGmailAssignee,
  type GmailAssigneeAccount,
} from "./gmail-assignee";
import { createPersonForAccount, searchPeopleForAccount } from "./people.server";
import { GOOGLE_CONTACTS_READONLY_SCOPE, GOOGLE_CONTACTS_WRITE_SCOPE } from "./scopes";

type GmailAssigneeServerRequest = {
  accountIndex: number;
  authenticatedEmail: string | null;
  gmailParticipants: GmailParticipants;
  ownerUserId: string;
  supabase: SupabaseClient<Database>;
};

export async function resolveGmailAssigneeForParticipants({
  accountIndex,
  authenticatedEmail,
  gmailParticipants,
  ownerUserId,
  supabase,
}: GmailAssigneeServerRequest) {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("id, email, connection_status, granted_scopes")
    .eq("owner_user_id", ownerUserId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("Connected Google accounts could not be loaded.");

  const connected = (data ?? []).filter((account) => account.connection_status === "connected");
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
    message: gmailParticipants,
    selfEmails,
    findExistingContact: async (email) => {
      const { data: contacts, error: contactError } = await supabase
        .from("contact_references")
        .select("id, display_name, email, provider_resource_name")
        .eq("owner_user_id", ownerUserId)
        .eq("is_self", false)
        .ilike("email", email)
        .limit(10);
      if (contactError) throw new Error("Player references could not be searched.");
      return exactCanonicalCachedContact(
        (contacts ?? []).map((contact) => ({
          displayName: contact.display_name,
          email: contact.email,
          id: contact.id,
          providerResourceName: contact.provider_resource_name,
        })),
        email,
      );
    },
    searchGoogleContacts: async (account, email) => {
      if (!accountById.get(account.id)?.granted_scopes.includes(GOOGLE_CONTACTS_READONLY_SCOPE)) {
        return [];
      }
      const results = await searchPeopleForAccount({
        googleAccountId: account.id,
        ownerUserId,
        query: email,
      });
      return results.filter((result) => result.kind === "contact");
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

export async function createGmailAssigneeForParticipants(
  request: GmailAssigneeServerRequest,
) {
  const resolution = await resolveGmailAssigneeForParticipants(request);
  if (resolution.status !== "contact_not_found") return resolution;
  if (!resolution.googleAccountId) {
    return { reason: "google_account_unavailable", status: "failed" } as const;
  }
  const { data: account, error } = await request.supabase
    .from("google_accounts")
    .select("granted_scopes")
    .eq("id", resolution.googleAccountId)
    .eq("owner_user_id", request.ownerUserId)
    .maybeSingle();
  if (error || !account?.granted_scopes.includes(GOOGLE_CONTACTS_WRITE_SCOPE)) {
    return { reason: "contacts_write_permission_missing", status: "failed" } as const;
  }
  const contact = await createPersonForAccount({
    email: resolution.counterparty.email,
    googleAccountId: resolution.googleAccountId,
    name: resolution.counterparty.name,
    ownerUserId: request.ownerUserId,
  });
  const saved = await upsertSelectedContactReference({
    contact,
    googleAccountId: resolution.googleAccountId,
    ownerUserId: request.ownerUserId,
    persist: async (values) => {
      const { data, error: saveError } = await request.supabase
        .from("contact_references")
        .upsert(values, { onConflict: "google_account_id,provider_resource_name" })
        .select("id, display_name, provider_resource_name")
        .single();
      if (saveError || !data?.provider_resource_name) {
        throw new Error("Player reference could not be saved.");
      }
      return {
        displayName: data.display_name,
        id: data.id,
        providerResourceName: data.provider_resource_name,
      };
    },
  });
  return {
    contact: saved,
    counterparty: resolution.counterparty,
    source: "google_people" as const,
    status: "matched" as const,
  };
}
