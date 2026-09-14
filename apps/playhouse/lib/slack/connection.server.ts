import "server-only";

import { fetchSlackResourceName, SlackNameCache, SlackReconnectRequiredError } from "./api";
import { decryptSlackAccessToken, encryptSlackAccessToken } from "./credential-crypto";
import { MongoSlackConnectionRepository } from "./connection-repository";
import { parseSlackResource } from "./resource";

const cache = new SlackNameCache();
const RECONNECT_MESSAGE = "Slack authorization expired. Reconnect Slack in Settings.";

function encryptionKey() {
  const value = process.env.SLACK_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error("Slack server credentials are not configured.");
  return value;
}

export async function storeSlackConnection({
  accessToken,
  grantedScopes,
  ownerUserId,
  slackUserId,
  teamId,
  teamName,
}: {
  ownerUserId: string;
  accessToken: string;
  grantedScopes: string[];
  slackUserId: string;
  teamId: string;
  teamName: string;
}) {
  const credential = encryptSlackAccessToken(accessToken, encryptionKey());
  return new MongoSlackConnectionRepository().upsert({
    credential,
    grantedScopes,
    ownerUserId,
    slackUserId,
    teamId,
    teamName,
  });
}

export async function resolveSlackNameForOwner(ownerUserId: string, value: string) {
  const resource = parseSlackResource(value);
  let diagnosticUrl: URL | null = null;
  try {
    diagnosticUrl = new URL(value);
  } catch {
    // Parsing behavior remains owned by parseSlackResource.
  }
  console.info("SLACK_NAME_RESOURCE_PARSED", resource ? {
    hostname: diagnosticUrl?.hostname ?? null,
    pathname: diagnosticUrl?.pathname ?? null,
    resourceId: resource.id,
    resourceType: resource.type,
    teamId: resource.teamId,
  } : {
    hostname: diagnosticUrl?.hostname ?? null,
    pathname: diagnosticUrl?.pathname ?? null,
    resourceId: null,
    resourceType: null,
    teamId: null,
  });
  if (!resource) return null;
  const repository = new MongoSlackConnectionRepository();
  const connection = await repository.findConnected(ownerUserId, resource.teamId);
  let ownerConnections: Awaited<ReturnType<typeof repository.listForOwner>> = [];
  try {
    ownerConnections = await repository.listForOwner(ownerUserId);
  } catch {
    // Diagnostic lookup must not change name-resolution behavior.
  }
  const connectionSummary = connection
    ? ownerConnections.find((candidate) => candidate.slack_team_id === connection.slack_team_id)
    : resource.teamId
      ? ownerConnections.find((candidate) => candidate.slack_team_id === resource.teamId)
      : ownerConnections.length === 1
        ? ownerConnections[0]
        : null;
  console.info("SLACK_NAME_CONNECTION_LOOKUP", {
    connectedTeamId: connection?.slack_team_id ?? connectionSummary?.slack_team_id ?? null,
    connectedTeamName: connection?.slack_team_name ?? connectionSummary?.slack_team_name ?? null,
    connectionFound: Boolean(connection),
    connectionStatus: connection?.connection_status ?? connectionSummary?.connection_status ?? null,
    grantedScopes: connection?.granted_scopes ?? connectionSummary?.granted_scopes ?? [],
    ownerFound: ownerConnections.length > 0,
    requestedTeamId: resource.teamId,
    slackUserId: connection?.slack_user_id ?? connectionSummary?.slack_user_id ?? null,
    teamIdMatches: resource.teamId
      ? resource.teamId === (connection?.slack_team_id ?? connectionSummary?.slack_team_id)
      : null,
  });
  if (!connection) return null;
  try {
    const token = decryptSlackAccessToken({
      authenticationTag: connection.token_auth_tag,
      encryptedAccessToken: connection.encrypted_access_token,
      encryptionIv: connection.token_iv,
      encryptionVersion: connection.encryption_version,
    }, encryptionKey());
    return await cache.get(`${connection.slack_team_id}:${resource.type}:${resource.id}`, () =>
      fetchSlackResourceName(token, resource));
  } catch (error) {
    if (error instanceof SlackReconnectRequiredError) {
      await repository.markReconnectRequired(ownerUserId, connection.slack_team_id, RECONNECT_MESSAGE);
    }
    console.warn("[PlayHouse Slack] name resolution failed", {
      reason: error instanceof SlackReconnectRequiredError ? "reconnect_required" : "unavailable",
      resourceType: resource.type,
    });
    return null;
  }
}
