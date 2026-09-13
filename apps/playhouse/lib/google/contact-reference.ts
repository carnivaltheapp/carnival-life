import type { Database } from "../supabase/database.types";
import type { GoogleContactSummary } from "./people";

export type ContactReferenceWrite =
  Database["public"]["Tables"]["contact_references"]["Insert"];

export function isGooglePeopleResourceName(value: unknown): value is string {
  return typeof value === "string" && /^people\/[A-Za-z0-9_-]+$/.test(value);
}

export async function upsertSelectedContactReference<T>({
  contact,
  googleAccountId,
  ownerUserId,
  persist,
}: {
  contact: GoogleContactSummary;
  googleAccountId: string;
  ownerUserId: string;
  persist: (values: ContactReferenceWrite) => Promise<T>;
}) {
  return persist({
    display_name: contact.displayName,
    email: contact.email,
    google_account_id: googleAccountId,
    owner_user_id: ownerUserId,
    provider_resource_name: contact.resourceName,
  });
}
