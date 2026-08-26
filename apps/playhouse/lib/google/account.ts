import type { Session, SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../supabase/database.types";

const CONTACTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/contacts.readonly";

function identityText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function upsertGoogleAccountAfterSignIn({
  session,
  supabase,
}: {
  session: Session;
  supabase: SupabaseClient<Database>;
}) {
  const identity = session.user.identities?.find(
    (item) => item.provider === "google",
  );
  const identityData = identity?.identity_data ?? {};
  const providerSubject =
    identityText(identityData.sub) ?? identity?.id ?? null;

  if (!providerSubject) {
    return null;
  }

  const { data, error } = await supabase
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

  return error ? null : data?.id ?? null;
}
