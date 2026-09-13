import { NextResponse, type NextRequest } from "next/server";

import { storeSlackToken } from "../../../lib/slack/connection.server";
import { parseSlackOAuthResponse, validSlackOAuthState } from "../../../lib/slack/oauth";
import { createClient } from "../../../lib/supabase/server";

function redirect(request: NextRequest, status: string) {
  const response = NextResponse.redirect(new URL(`/?slack=${status}`, request.url));
  response.cookies.delete("playhouse_slack_oauth_state");
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const storedState = request.cookies.get("playhouse_slack_oauth_state")?.value ?? "";
  if (!code || !validSlackOAuthState(state, storedState)) return redirect(request, "state_error");
  const clientId = process.env.SLACK_OAUTH_CLIENT_ID;
  const clientSecret = process.env.SLACK_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.SLACK_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return redirect(request, "configuration");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const ownerUserId = typeof auth?.claims?.sub === "string" ? auth.claims.sub : null;
  if (authError || !ownerUserId) return redirect(request, "auth_error");
  try {
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const rawBody = await tokenResponse.json() as Parameters<typeof parseSlackOAuthResponse>[0];
    const body = parseSlackOAuthResponse(rawBody);
    if (!body) {
      console.error("[PlayHouse Slack] OAuth exchange failed", { reason: rawBody.error ?? "invalid_response" });
      return redirect(request, "connection_error");
    }
    const { data: connection, error } = await supabase.from("slack_connections").upsert({
      connection_status: "connected",
      granted_scopes: body.grantedScopes,
      owner_user_id: ownerUserId,
      slack_user_id: body.slackUserId,
      sync_error: null,
      team_id: body.teamId,
      team_name: body.teamName,
    }, { onConflict: "owner_user_id,team_id" }).select("id").single();
    if (error || !connection) return redirect(request, "storage_error");
    try {
      await storeSlackToken({ connectionId: connection.id, ownerUserId, accessToken: body.accessToken });
    } catch {
      await supabase.from("slack_connections")
        .update({ connection_status: "error", sync_error: "Reconnect Slack to finish setup." })
        .eq("id", connection.id)
        .eq("owner_user_id", ownerUserId);
      return redirect(request, "storage_error");
    }
    return redirect(request, "connected");
  } catch {
    console.error("[PlayHouse Slack] OAuth callback failed", { reason: "unexpected_error" });
    return redirect(request, "connection_error");
  }
}
