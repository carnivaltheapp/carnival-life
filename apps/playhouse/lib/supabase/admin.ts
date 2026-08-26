import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { getSupabaseConfig } from "./config";

export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const { url } = getSupabaseConfig();
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
