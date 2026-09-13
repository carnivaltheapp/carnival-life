"use server";

import { createClient } from "../../lib/supabase/server";

export type SlackConnectionStatus = {
  connected: boolean;
  needsReconnect: boolean;
  teamName: string | null;
};

export async function loadSlackConnectionStatus(): Promise<SlackConnectionStatus> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const ownerUserId = typeof auth?.claims?.sub === "string" ? auth.claims.sub : null;
  if (authError || !ownerUserId) return { connected: false, needsReconnect: false, teamName: null };
  const { data } = await supabase.from("slack_connections")
    .select("connection_status, team_name")
    .eq("owner_user_id", ownerUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    connected: data?.connection_status === "connected",
    needsReconnect: data?.connection_status === "error",
    teamName: data?.team_name ?? null,
  };
}
