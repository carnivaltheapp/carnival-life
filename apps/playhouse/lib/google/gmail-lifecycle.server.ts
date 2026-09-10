import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../supabase/database.types";
import { GmailApiError, unstarGmailThread } from "./gmail";
import type { GmailLifecycleResult } from "./gmail-lifecycle";
import { GOOGLE_GMAIL_MODIFY_SCOPE } from "./scopes";
import { GoogleAccountReconnectRequiredError } from "./token-broker";
import { getGoogleAccessToken } from "./token-broker.server";

function logGmailFailure(stage: string, details: { code?: string; status?: number } = {}) {
  console.error("[PlayHouse Gmail] lifecycle failure", { ...details, stage });
}

export async function unstarGmailPlayThread({
  ownerUserId,
  supabase,
  threadId,
}: {
  ownerUserId: string;
  supabase: SupabaseClient<Database>;
  threadId: string;
}): Promise<GmailLifecycleResult> {
  const { data: accounts, error } = await supabase
    .from("google_accounts")
    .select("id, connection_status, granted_scopes")
    .eq("owner_user_id", ownerUserId)
    .order("updated_at", { ascending: false });
  if (error) {
    logGmailFailure("connected_account_read", { code: error.code });
    return {
      message: "The connected Google account could not be loaded. The Play was left active.",
      success: false,
    };
  }

  const connected = (accounts ?? []).filter(
    (account) => account.connection_status === "connected",
  );
  if (connected.length === 0) {
    logGmailFailure(accounts?.length ? "account_disconnected" : "account_missing");
    return {
      message: "Reconnect the Google account for this Gmail Play before trying again.",
      success: false,
    };
  }
  if (connected.length > 1) {
    logGmailFailure("account_ambiguous");
    return {
      message: "This Gmail Play does not identify which connected Google account owns it. The Play was left active.",
      success: false,
    };
  }

  const account = connected[0];
  if (!account.granted_scopes.includes(GOOGLE_GMAIL_MODIFY_SCOPE)) {
    logGmailFailure("gmail_permission_missing");
    return {
      message: "Reconnect Google to grant Gmail permission, then try again. The Play was left active.",
      success: false,
    };
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken({
      googleAccountId: account.id,
      ownerUserId,
    });
  } catch (tokenError) {
    if (tokenError instanceof GoogleAccountReconnectRequiredError) {
      logGmailFailure("token_reconnect_required");
      return {
        message: "Reconnect Google before trying again. The Play was left active.",
        success: false,
      };
    }
    logGmailFailure("token_refresh");
    return {
      message: "Google authorization is temporarily unavailable. The Play was left active; try again.",
      success: false,
    };
  }

  try {
    await unstarGmailThread({ accessToken, threadId });
    return { success: true };
  } catch (gmailError) {
    if (gmailError instanceof GmailApiError) {
      logGmailFailure(
        gmailError.status === 401 || gmailError.status === 403
          ? "gmail_permission"
          : "gmail_api",
        { status: gmailError.status },
      );
      return {
        message: gmailError.status === 401 || gmailError.status === 403
          ? "Reconnect Google to grant Gmail permission, then try again. The Play was left active."
          : "Gmail could not update this thread. The Play was left active; try again.",
        success: false,
      };
    }
    logGmailFailure("gmail_network");
    return {
      message: "Gmail is temporarily unavailable. The Play was left active; try again.",
      success: false,
    };
  }
}
