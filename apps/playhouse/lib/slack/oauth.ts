import { timingSafeEqual } from "node:crypto";

export const SLACK_USER_SCOPES = [
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "users:read",
] as const;

type SlackOAuthResponse = {
  ok?: boolean;
  error?: string;
  team?: { id?: string; name?: string };
  authed_user?: { access_token?: string; id?: string; scope?: string };
};

export function slackAuthorizationUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("user_scope", SLACK_USER_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export function hasRequiredSlackScopes(scopes: string | string[]) {
  const granted = new Set((Array.isArray(scopes) ? scopes : scopes.split(","))
    .map((scope) => scope.trim()));
  return SLACK_USER_SCOPES.every((scope) => granted.has(scope));
}

export function slackConnectionNeedsReconnect(
  status: "connected" | "error",
  scopes: string[],
) {
  return status === "error" || !hasRequiredSlackScopes(scopes);
}

export function validSlackOAuthState(received: string, stored: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(stored);
  return Boolean(left.length && left.length === right.length && timingSafeEqual(left, right));
}

export function parseSlackOAuthResponse(body: SlackOAuthResponse) {
  const scopes = body.authed_user?.scope ?? "";
  if (
    !body.ok || !body.authed_user?.access_token || !body.authed_user.id ||
    !body.team?.id || !body.team.name || !hasRequiredSlackScopes(scopes)
  ) return null;
  return {
    accessToken: body.authed_user.access_token,
    grantedScopes: scopes.split(",").map((scope) => scope.trim()).filter(Boolean),
    slackUserId: body.authed_user.id,
    teamId: body.team.id,
    teamName: body.team.name,
  };
}
