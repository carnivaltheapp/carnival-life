"use server";

import { createClient } from "../../lib/supabase/server";
import { MongoSlackConnectionRepository } from "../../lib/slack/connection-repository";

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
  const [connection] = await new MongoSlackConnectionRepository().listForOwner(ownerUserId);
  return {
    connected: connection?.connection_status === "connected",
    needsReconnect: connection?.connection_status === "error",
    teamName: connection?.slack_team_name ?? null,
  };
}
