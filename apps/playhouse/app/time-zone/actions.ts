"use server";

import { isSupportedTimeZone } from "../../lib/playhouse/time-zone";
import { createClient } from "../../lib/supabase/server";

export async function saveBrowserTimeZone(timeZone: string) {
  if (!isSupportedTimeZone(timeZone)) return false;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (error || !userId) return false;
  const result = await supabase
    .from("users")
    .update({ timezone: timeZone })
    .eq("id", userId);
  return !result.error;
}
