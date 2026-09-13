import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { slackAuthorizationUrl } from "../../../lib/slack/oauth";
import { createClient } from "../../../lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || typeof data?.claims?.sub !== "string") return NextResponse.redirect(new URL("/", request.url));
  const clientId = process.env.SLACK_OAUTH_CLIENT_ID;
  const redirectUri = process.env.SLACK_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) return NextResponse.redirect(new URL("/?slack=configuration", request.url));
  const state = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(slackAuthorizationUrl({ clientId, redirectUri, state }));
  response.cookies.set("playhouse_slack_oauth_state", state, {
    httpOnly: true,
    maxAge: 600,
    path: "/slack/callback",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
