import "server-only";

import { createAdminClient } from "../supabase/admin";
import { fetchSlackResourceName, SlackNameCache, SlackReconnectRequiredError } from "./api";
import { decryptSlackAccessToken, encryptSlackAccessToken } from "./credential-crypto";
import { parseSlackResource } from "./resource";

const cache = new SlackNameCache();
const RECONNECT_MESSAGE = "Slack authorization expired. Reconnect Slack in Settings.";

function encryptionKey() {
  const value = process.env.SLACK_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error("Slack server credentials are not configured.");
  return value;
}

export async function storeSlackToken({ connectionId, ownerUserId, accessToken }: {
  connectionId: string;
  ownerUserId: string;
  accessToken: string;
}) {
  const credential = encryptSlackAccessToken(accessToken, encryptionKey());
  const { error } = await createAdminClient().rpc("store_slack_connection_credential", {
    p_encrypted_access_token: credential.encryptedAccessToken,
    p_encryption_iv: credential.encryptionIv,
    p_encryption_version: credential.encryptionVersion,
    p_owner_user_id: ownerUserId,
    p_slack_connection_id: connectionId,
  });
  if (error) throw new Error("Slack authorization could not be stored securely.");
}

async function accessToken(connectionId: string, ownerUserId: string) {
  const { data, error } = await createAdminClient().rpc("get_slack_connection_credential", {
    p_owner_user_id: ownerUserId,
    p_slack_connection_id: connectionId,
  });
  const stored = data?.[0];
  if (error || !stored) throw new SlackReconnectRequiredError(RECONNECT_MESSAGE);
  return decryptSlackAccessToken({
    encryptedAccessToken: stored.encrypted_access_token,
    encryptionIv: stored.encryption_iv,
    encryptionVersion: stored.encryption_version,
  }, encryptionKey());
}

export async function resolveSlackNameForOwner(ownerUserId: string, value: string) {
  const resource = parseSlackResource(value);
  if (!resource) return null;
  const admin = createAdminClient();
  let query = admin.from("slack_connections")
    .select("id, team_id")
    .eq("owner_user_id", ownerUserId)
    .eq("connection_status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (resource.teamId) query = query.eq("team_id", resource.teamId);
  const { data: connection } = await query.maybeSingle();
  if (!connection) return null;
  try {
    const token = await accessToken(connection.id, ownerUserId);
    return await cache.get(`${connection.team_id}:${resource.type}:${resource.id}`, () =>
      fetchSlackResourceName(token, resource));
  } catch (error) {
    if (error instanceof SlackReconnectRequiredError) {
      await admin.from("slack_connections")
        .update({ connection_status: "error", sync_error: RECONNECT_MESSAGE })
        .eq("id", connection.id)
        .eq("owner_user_id", ownerUserId);
    }
    console.warn("[PlayHouse Slack] name resolution failed", {
      reason: error instanceof SlackReconnectRequiredError ? "reconnect_required" : "unavailable",
      resourceType: resource.type,
    });
    return null;
  }
}
