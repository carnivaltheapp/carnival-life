import "server-only";

import { dateInTimeZone } from "../playhouse/data";
import { resolveTimeZone } from "../playhouse/time-zone";
import { createAdminClient } from "../supabase/admin";
import {
  getGmailMessageMetadata,
  GmailIncomingApiError,
  listGmailAddedMessages,
  registerGmailMailboxWatch,
} from "../google/gmail-incoming";
import { GOOGLE_GMAIL_MODIFY_SCOPE } from "../google/scopes";
import { getGoogleAccessToken } from "../google/token-broker.server";
import { normalizeGmailIncomingMessage } from "./gmail-adapter";
import { recordGmailDiagnostic } from "./gmail-diagnostics";
import { MongoGmailWatchRepository } from "./gmail-watch-repository";
import { MongoIncomingEventService } from "./mongo-incoming-event-store";
import { processIncomingEvent } from "../../domain/incoming-event";

type ConnectedGoogleAccount = {
  email: string;
  id: string;
  owner_user_id: string;
};

function topicName() {
  const value = process.env.GMAIL_PUBSUB_TOPIC?.trim();
  if (!value || !/^projects\/[^/]+\/topics\/[^/]+$/.test(value)) {
    throw new Error("GMAIL_PUBSUB_TOPIC is not configured.");
  }
  return value;
}

async function connectedAccount(googleAccountId: string, ownerUserId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("google_accounts")
    .select("id, owner_user_id, email, granted_scopes, connection_status")
    .eq("id", googleAccountId)
    .eq("owner_user_id", ownerUserId)
    .eq("connection_status", "connected")
    .maybeSingle();
  if (error || !data?.email || !data.granted_scopes.includes(GOOGLE_GMAIL_MODIFY_SCOPE)) {
    return null;
  }
  return { email: data.email, id: data.id, owner_user_id: data.owner_user_id };
}

export async function registerGmailWatchForAccount({
  account,
  now = new Date(),
  repository = new MongoGmailWatchRepository(),
  resetHistory = false,
}: {
  account: ConnectedGoogleAccount;
  now?: Date;
  repository?: MongoGmailWatchRepository;
  resetHistory?: boolean;
}) {
  const accessToken = await getGoogleAccessToken({
    googleAccountId: account.id,
    ownerUserId: account.owner_user_id,
  });
  const watch = await registerGmailMailboxWatch({
    accessToken,
    topicName: topicName(),
  });
  await repository.upsertWatch({
    email: account.email,
    expiration: new Date(Number(watch.expiration)),
    googleAccountId: account.id,
    historyId: watch.historyId,
    now,
    ownerUserId: account.owner_user_id,
    resetHistory,
  });
  return watch;
}

export async function registerGmailWatchForOwnerAccount({
  googleAccountId,
  ownerUserId,
}: {
  googleAccountId: string;
  ownerUserId: string;
}) {
  if (!process.env.GMAIL_PUBSUB_TOPIC?.trim()) return false;
  const account = await connectedAccount(googleAccountId, ownerUserId);
  if (!account) return false;
  await registerGmailWatchForAccount({ account });
  return true;
}

export async function renewConnectedGmailWatches() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("google_accounts")
    .select("id, owner_user_id, email, granted_scopes, connection_status")
    .eq("connection_status", "connected")
    .contains("granted_scopes", [GOOGLE_GMAIL_MODIFY_SCOPE]);
  if (error) throw new Error("Connected Gmail accounts could not be loaded.");
  let renewed = 0;
  let failed = 0;
  for (const row of data) {
    if (!row.email) continue;
    try {
      await registerGmailWatchForAccount({
        account: { email: row.email, id: row.id, owner_user_id: row.owner_user_id },
      });
      renewed += 1;
    } catch (watchError) {
      failed += 1;
      console.warn("CARNIVAL_INCOMING_EVENT GMAIL_WATCH_RENEWAL_FAILED", {
        googleAccountId: row.id,
        reason: watchError instanceof Error ? watchError.name : "unknown_error",
      });
    }
  }
  return { failed, renewed };
}

async function ownerTimeZone(ownerUserId: string) {
  const { data } = await createAdminClient()
    .from("users")
    .select("timezone")
    .eq("id", ownerUserId)
    .maybeSingle();
  return resolveTimeZone(null, data?.timezone);
}

export async function processGmailNotification({
  emailAddress,
  historyId,
  now = new Date(),
  repository = new MongoGmailWatchRepository(),
}: {
  emailAddress: string;
  historyId: string;
  now?: Date;
  repository?: MongoGmailWatchRepository;
}) {
  const states = await repository.findByEmail(emailAddress);
  if (states.length !== 1) {
    console.warn("CARNIVAL_INCOMING_EVENT GMAIL_NOTIFICATION_ACCOUNT_UNRESOLVED", {
      candidateCount: states.length,
    });
    return { ignored: true as const, reason: states.length ? "ambiguous_account" : "unknown_account" };
  }
  const state = states[0];
  const account = await connectedAccount(state.google_account_id, state.owner_user_id);
  if (!account || account.email.trim().toLocaleLowerCase() !== emailAddress.toLocaleLowerCase()) {
    return { ignored: true as const, reason: "account_not_connected" };
  }
  await recordGmailDiagnostic({
    ownerUserId: account.owner_user_id,
    reason: "account_resolved",
    stage: "GMAIL_NOTIFICATION_RECEIVED",
  });
  const claim = await repository.claimNotification(account.id, historyId, now);
  if (claim.duplicate) return { duplicate: true as const };
  if ("busy" in claim && claim.busy) return { busy: true as const };

  const accessToken = await getGoogleAccessToken({
    googleAccountId: account.id,
    ownerUserId: account.owner_user_id,
  });
  try {
    console.info("CARNIVAL_INCOMING_EVENT GMAIL_HISTORY_FETCH", {
      googleAccountId: account.id,
      startHistoryId: state.history_id,
    });
    const history = await listGmailAddedMessages({
      accessToken,
      startHistoryId: state.history_id,
    });
    const timeZone = await ownerTimeZone(account.owner_user_id);
    const todayDate = dateInTimeZone(now, timeZone);
    const service = new MongoIncomingEventService();
    let processed = 0;
    for (const item of history.messages) {
      const message = await getGmailMessageMetadata({ accessToken, messageId: item.id });
      const event = normalizeGmailIncomingMessage({
        accountEmail: account.email,
        gmailAccountId: account.id,
        message,
        now,
        ownerUserId: account.owner_user_id,
      });
      if (!event) continue;
      await recordGmailDiagnostic({
        apiThreadPresent: Boolean(event.externalThreadId),
        ownerUserId: event.ownerUserId,
        reason: "message_normalized",
        stage: "GMAIL_NOTIFICATION_NORMALIZED",
        threadId: event.externalThreadId,
      });
      await processIncomingEvent({ event, matchEngine: service, store: service, todayDate });
      processed += 1;
    }
    await repository.completeHistory(
      account.id,
      history.latestHistoryId === state.history_id ? historyId : history.latestHistoryId,
      now,
    );
    return { duplicate: false as const, processed };
  } catch (error) {
    await recordGmailDiagnostic({
      ownerUserId: account.owner_user_id,
      reason: "notification_processing_failed",
      stage: "GMAIL_NOTIFICATION_RECEIVED",
    });
    if (error instanceof GmailIncomingApiError && error.status === 404) {
      // An expired Gmail history cursor must establish a new baseline, never replay old mail.
      await registerGmailWatchForAccount({
        account,
        now,
        repository,
        resetHistory: true,
      });
      return { ignored: true as const, reason: "history_baseline_reset" };
    }
    await repository.fail(
      account.id,
      error instanceof Error ? error.name : "gmail_notification_failed",
      now,
    );
    throw error;
  }
}
