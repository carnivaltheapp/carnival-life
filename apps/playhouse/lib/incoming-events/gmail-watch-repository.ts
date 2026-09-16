import "server-only";

import type { Collection } from "mongodb";

import { getCarnivalMongoDatabase } from "../playhouse/mongo-client";

const WATCH_COLLECTION = "carnival_gmail_watch_states";
const LOCK_MS = 60_000;

export type GmailWatchState = {
  created_at: Date;
  email: string;
  expiration: Date;
  google_account_id: string;
  history_id: string;
  last_error: string | null;
  last_notification_at: Date | null;
  locked_until: Date | null;
  owner_user_id: string;
  status: "active" | "error" | "renewal_required";
  updated_at: Date;
};

declare global {
  var carnivalGmailWatchIndexPromise: Promise<unknown> | undefined;
}

async function defaultCollection() {
  const collection = (await getCarnivalMongoDatabase())
    .collection<GmailWatchState>(WATCH_COLLECTION);
  globalThis.carnivalGmailWatchIndexPromise ??= Promise.all([
    collection.createIndex(
      { google_account_id: 1 },
      { name: "gmail_account_watch_unique", unique: true },
    ),
    collection.createIndex(
      { email: 1, status: 1 },
      { name: "gmail_email_active_watch" },
    ),
    collection.createIndex(
      { expiration: 1, status: 1 },
      { name: "gmail_watch_expiration" },
    ),
  ]);
  await globalThis.carnivalGmailWatchIndexPromise;
  return collection;
}

function historyAtLeast(left: string, right: string) {
  try {
    return BigInt(left) >= BigInt(right);
  } catch {
    return left === right;
  }
}

export class MongoGmailWatchRepository {
  constructor(
    private readonly collection: () => Promise<Collection<GmailWatchState>> = defaultCollection,
  ) {}

  async upsertWatch({
    email,
    expiration,
    googleAccountId,
    historyId,
    ownerUserId,
    now = new Date(),
    resetHistory = false,
  }: {
    email: string;
    expiration: Date;
    googleAccountId: string;
    historyId: string;
    now?: Date;
    ownerUserId: string;
    resetHistory?: boolean;
  }) {
    const setValues: Partial<GmailWatchState> = {
      email: email.trim().toLocaleLowerCase(),
      expiration,
      last_error: null,
      locked_until: null,
      owner_user_id: ownerUserId,
      status: "active",
      updated_at: now,
    };
    if (resetHistory) setValues.history_id = historyId;
    const insertValues: Pick<GmailWatchState, "created_at" | "last_notification_at"> &
      Partial<Pick<GmailWatchState, "history_id">> = {
        created_at: now,
        last_notification_at: null,
      };
    if (!resetHistory) insertValues.history_id = historyId;
    await (await this.collection()).updateOne(
      { google_account_id: googleAccountId },
      {
        $set: setValues,
        $setOnInsert: insertValues,
      },
      { upsert: true },
    );
  }

  async findByEmail(email: string) {
    return (await this.collection()).find({
      email: email.trim().toLocaleLowerCase(),
      status: { $in: ["active", "error"] },
    }).limit(2).toArray();
  }

  async claimNotification(
    googleAccountId: string,
    notificationHistoryId: string,
    now = new Date(),
  ) {
    const collection = await this.collection();
    const current = await collection.findOne({ google_account_id: googleAccountId });
    if (!current || historyAtLeast(current.history_id, notificationHistoryId)) {
      return { duplicate: true as const, state: current };
    }
    const claimed = await collection.findOneAndUpdate({
      google_account_id: googleAccountId,
      $or: [
        { locked_until: null },
        { locked_until: { $lte: now } },
        { locked_until: { $exists: false } },
      ],
    }, {
      $set: {
        last_notification_at: now,
        locked_until: new Date(now.getTime() + LOCK_MS),
        updated_at: now,
      },
    }, { returnDocument: "after" });
    return claimed
      ? { duplicate: false as const, state: claimed }
      : { busy: true as const, duplicate: false as const, state: null };
  }

  async completeHistory(googleAccountId: string, historyId: string, now = new Date()) {
    await (await this.collection()).updateOne(
      { google_account_id: googleAccountId },
      { $set: {
        history_id: historyId,
        last_error: null,
        locked_until: null,
        status: "active",
        updated_at: now,
      } },
    );
  }

  async fail(googleAccountId: string, reason: string, now = new Date()) {
    await (await this.collection()).updateOne(
      { google_account_id: googleAccountId },
      { $set: {
        last_error: reason.slice(0, 160),
        locked_until: null,
        status: "error",
        updated_at: now,
      } },
    );
  }
}

export const GMAIL_WATCH_COLLECTION = WATCH_COLLECTION;
