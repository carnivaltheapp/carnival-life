import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../supabase/database.types";
import { GmailApiError, trashGmailThread, unstarGmailThread } from "./gmail";
import { GOOGLE_GMAIL_MODIFY_SCOPE } from "./scopes";
import { GoogleAccountReconnectRequiredError } from "./token-broker";
import { getGoogleAccessToken } from "./token-broker.server";
import type {
  GmailLifecycleAction,
  GmailLifecycleCleanupResult,
  GmailLifecycleReason,
  GmailLifecycleStepResult,
} from "./gmail-lifecycle";

export type GmailLifecycleContext = {
  accountResolved: boolean;
  googleAccountId: string | null;
  reason: GmailLifecycleReason | null;
};

function unavailableStep(reason: GmailLifecycleReason): GmailLifecycleStepResult {
  return { attempted: false, reason, success: false };
}

function failedStep(reason: GmailLifecycleReason): GmailLifecycleStepResult {
  return { attempted: true, reason, success: false };
}

export async function resolveGmailLifecycleContext({
  accountIndex,
  ownerUserId,
  supabase,
}: {
  accountIndex: number | null | undefined;
  ownerUserId: string;
  supabase: SupabaseClient<Database>;
}): Promise<GmailLifecycleContext> {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("id, connection_status, granted_scopes")
    .eq("owner_user_id", ownerUserId)
    .order("updated_at", { ascending: false });
  if (error || !data?.length) {
    return { accountResolved: false, googleAccountId: null, reason: "account_missing" };
  }
  const connected = data.filter(({ connection_status }) => connection_status === "connected");
  const index = Number.isSafeInteger(accountIndex) && Number(accountIndex) >= 0
    ? Number(accountIndex)
    : 0;
  const account = connected[index];
  if (!account) {
    return { accountResolved: false, googleAccountId: null, reason: "account_disconnected" };
  }
  if (!account.granted_scopes.includes(GOOGLE_GMAIL_MODIFY_SCOPE)) {
    return {
      accountResolved: true,
      googleAccountId: account.id,
      reason: "gmail_permission_missing",
    };
  }
  return { accountResolved: true, googleAccountId: account.id, reason: null };
}

export async function syncGmailPlayLifecycle({
  action,
  apiThreadId,
  context,
  ownerUserId,
}: {
  action: GmailLifecycleAction;
  apiThreadId: string | null | undefined;
  context: GmailLifecycleContext;
  ownerUserId: string;
}): Promise<GmailLifecycleCleanupResult> {
  const threadId = apiThreadId?.trim();
  if (!threadId) {
    return {
      accountResolved: context.accountResolved,
      trash: action === "trash" ? unavailableStep("api_thread_missing") : null,
      unstar: unavailableStep("api_thread_missing"),
    };
  }
  if (!context.googleAccountId || context.reason) {
    const reason = context.reason ?? "account_missing";
    return {
      accountResolved: context.accountResolved,
      trash: action === "trash" ? unavailableStep(reason) : null,
      unstar: unavailableStep(reason),
    };
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken({
      googleAccountId: context.googleAccountId,
      ownerUserId,
    });
  } catch (error) {
    const reason: GmailLifecycleReason = error instanceof GoogleAccountReconnectRequiredError
      ? "account_disconnected"
      : "token_unavailable";
    return {
      accountResolved: context.accountResolved,
      trash: action === "trash" ? unavailableStep(reason) : null,
      unstar: unavailableStep(reason),
    };
  }

  let unstar: GmailLifecycleStepResult;
  try {
    await unstarGmailThread({ accessToken, threadId });
    unstar = { attempted: true, reason: "completed", success: true };
  } catch (error) {
    unstar = failedStep(
      error instanceof GmailApiError && (error.status === 401 || error.status === 403)
        ? "gmail_permission_denied"
        : "gmail_unstar_failed",
    );
  }

  let trash: GmailLifecycleStepResult | null = null;
  if (action === "trash") {
    try {
      await trashGmailThread({ accessToken, threadId });
      trash = { attempted: true, reason: "completed", success: true };
    } catch (error) {
      trash = failedStep(
        error instanceof GmailApiError && (error.status === 401 || error.status === 403)
          ? "gmail_permission_denied"
          : "gmail_trash_failed",
      );
    }
  }

  return { accountResolved: context.accountResolved, trash, unstar };
}
