import "server-only";

import { createClient } from "../supabase/server";

export async function authenticatedDevelopmentOwner() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const ownerUserId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  return error ? null : ownerUserId;
}
