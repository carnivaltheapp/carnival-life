import "server-only";

import {
  decryptGoogleRefreshToken,
  encryptGoogleRefreshToken,
} from "./credential-crypto";
import {
  GoogleAccountReconnectRequiredError,
  refreshGoogleAccessToken,
  retainRefreshTokenIfPresent,
} from "./token-broker";
import { createAdminClient } from "../supabase/admin";

const RECONNECT_MESSAGE =
  "Google authorization has expired. Sign out and sign in with Google to reconnect.";

function logTokenFailure(
  stage: string,
  details: { code?: string; needsReconnect?: boolean } = {},
) {
  console.error("[PlayHouse Calendar] token failure", { ...details, stage });
}

function requiredEnvironmentVariable(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error("Google server credentials are not configured.");
  }
  return value;
}

export async function retainGoogleRefreshToken({
  googleAccountId,
  ownerUserId,
  providerRefreshToken,
}: {
  googleAccountId: string;
  ownerUserId: string;
  providerRefreshToken: string | null | undefined;
}) {
  return retainRefreshTokenIfPresent(providerRefreshToken, async (refreshToken) => {
    const credential = encryptGoogleRefreshToken(
      refreshToken,
      requiredEnvironmentVariable("GOOGLE_TOKEN_ENCRYPTION_KEY"),
    );
    const admin = createAdminClient();
    const { error } = await admin.rpc("store_google_account_credential", {
      p_encrypted_refresh_token: credential.encryptedRefreshToken,
      p_encryption_iv: credential.encryptionIv,
      p_encryption_version: credential.encryptionVersion,
      p_google_account_id: googleAccountId,
      p_owner_user_id: ownerUserId,
    });

    if (error) {
      throw new Error("Google authorization could not be stored securely.");
    }
  });
}

export async function getGoogleAccessToken({
  googleAccountId,
  ownerUserId,
}: {
  googleAccountId: string;
  ownerUserId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_google_account_credential", {
    p_google_account_id: googleAccountId,
    p_owner_user_id: ownerUserId,
  });
  const stored = data?.[0];

  if (error || !stored) {
    logTokenFailure("credential_read", { code: error?.code });
    throw new GoogleAccountReconnectRequiredError(RECONNECT_MESSAGE);
  }

  let refreshToken: string;
  try {
    refreshToken = decryptGoogleRefreshToken(
      {
        encryptedRefreshToken: stored.encrypted_refresh_token,
        encryptionIv: stored.encryption_iv,
        encryptionVersion: stored.encryption_version,
      },
      requiredEnvironmentVariable("GOOGLE_TOKEN_ENCRYPTION_KEY"),
    );
  } catch {
    logTokenFailure("credential_decryption");
    throw new Error("Google authorization could not be decrypted.");
  }

  let result: Awaited<ReturnType<typeof refreshGoogleAccessToken>>;
  try {
    result = await refreshGoogleAccessToken({
      clientId: requiredEnvironmentVariable("GOOGLE_OAUTH_CLIENT_ID"),
      clientSecret: requiredEnvironmentVariable("GOOGLE_OAUTH_CLIENT_SECRET"),
      refreshToken,
    });
  } catch {
    logTokenFailure("access_token_refresh");
    throw new Error("Google authorization is temporarily unavailable.");
  }

  if (!result.success) {
    logTokenFailure("access_token_refresh", {
      needsReconnect: result.needsReconnect,
    });
    if (result.needsReconnect) {
      const { error: statusError } = await admin
        .from("google_accounts")
        .update({ connection_status: "error", sync_error: RECONNECT_MESSAGE })
        .eq("id", googleAccountId)
        .eq("owner_user_id", ownerUserId);
      if (statusError) {
        logTokenFailure("reconnect_state_persistence", {
          code: statusError.code,
        });
      }
      throw new GoogleAccountReconnectRequiredError(RECONNECT_MESSAGE);
    }
    throw new Error("Google authorization is temporarily unavailable.");
  }

  const { error: statusError } = await admin
    .from("google_accounts")
    .update({ connection_status: "connected", sync_error: null })
    .eq("id", googleAccountId)
    .eq("owner_user_id", ownerUserId);
  if (statusError) {
    logTokenFailure("connected_state_persistence", { code: statusError.code });
  }

  return result.accessToken;
}
