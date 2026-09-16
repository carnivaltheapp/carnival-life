import "server-only";

import type { Collection } from "mongodb";

import { exactDriveFolderUrl } from "../../domain/tree-of-life-drive";
import { createAdminClient } from "../supabase/admin";
import { MongoTreeOfLifeRepository } from "../tree-of-life/repository";
import { getCarnivalMongoDatabase } from "../playhouse/mongo-client";
import { GOOGLE_DRIVE_METADATA_READONLY_SCOPE } from "./scopes";
import { createDriveHierarchyResolver } from "./drive.server";
import { GoogleAccountReconnectRequiredError } from "./token-broker";

const COLLECTION_NAME = "tree_of_life_drive_reconciliation";
const LEASE_MS = 30_000;
const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000, 900_000];

type DriveJobStatus = "ambiguous" | "auth_required" | "error" | "pending" | "resolved";

type DriveJobDocument = {
  attempt_count: number;
  created_at: Date;
  last_attempt_at: Date | null;
  last_error: string | null;
  locked_until: Date | null;
  next_attempt_at: Date | null;
  owner_user_id: string;
  priority: number;
  relative_path: string;
  resolved_at: Date | null;
  short_term_exhausted: boolean;
  status: DriveJobStatus;
  updated_at: Date;
};

type DriveJobCollection = Collection<DriveJobDocument>;

declare global {
  var carnivalDriveJobIndexPromise: Promise<unknown> | undefined;
}

async function defaultCollection() {
  const collection = (await getCarnivalMongoDatabase()).collection<DriveJobDocument>(COLLECTION_NAME);
  globalThis.carnivalDriveJobIndexPromise ??= Promise.all([
    collection.createIndex(
      { owner_user_id: 1, relative_path: 1 },
      { name: "owner_drive_path_unique", unique: true },
    ),
    collection.createIndex(
      { owner_user_id: 1, status: 1, priority: 1, next_attempt_at: 1 },
      { name: "owner_due_drive_resolution" },
    ),
  ]);
  await globalThis.carnivalDriveJobIndexPromise;
  return collection;
}

export class MongoDriveReconciliationRepository {
  constructor(private readonly collection: () => Promise<DriveJobCollection> = defaultCollection) {}

  async enqueue(ownerUserId: string, relativePath: string, isBranch: boolean, now = new Date()) {
    await (await this.collection()).updateOne(
      { owner_user_id: ownerUserId, relative_path: relativePath },
      {
        $min: { priority: isBranch ? 0 : 1 },
        $set: { updated_at: now },
        $setOnInsert: {
          attempt_count: 0,
          created_at: now,
          last_attempt_at: null,
          last_error: null,
          locked_until: null,
          next_attempt_at: now,
          owner_user_id: ownerUserId,
          relative_path: relativePath,
          resolved_at: null,
          short_term_exhausted: false,
          status: "pending",
        },
      },
      { upsert: true },
    );
  }

  async claimDue(ownerUserId: string, now = new Date()) {
    return (await this.collection()).findOneAndUpdate(
      {
        locked_until: { $not: { $gt: now } },
        next_attempt_at: { $lte: now },
        owner_user_id: ownerUserId,
        status: { $in: ["ambiguous", "auth_required", "error", "pending"] },
      },
      { $set: { last_attempt_at: now, locked_until: new Date(now.getTime() + LEASE_MS), updated_at: now } },
      { returnDocument: "after", sort: { priority: 1, next_attempt_at: 1, created_at: 1 } },
    );
  }

  async resolve(ownerUserId: string, relativePath: string, now = new Date()) {
    await (await this.collection()).updateOne(
      { owner_user_id: ownerUserId, relative_path: relativePath },
      { $set: {
        last_error: null,
        locked_until: null,
        next_attempt_at: null,
        resolved_at: now,
        status: "resolved",
        updated_at: now,
      } },
    );
  }

  async retry(
    job: Pick<DriveJobDocument, "attempt_count" | "owner_user_id" | "relative_path">,
    status: Exclude<DriveJobStatus, "resolved">,
    reason: string,
    now = new Date(),
  ) {
    const attemptCount = job.attempt_count + 1;
    const shortTermExhausted = attemptCount >= RETRY_DELAYS_MS.length;
    const delay = RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
    await (await this.collection()).updateOne(
      { owner_user_id: job.owner_user_id, relative_path: job.relative_path },
      { $set: {
        attempt_count: attemptCount,
        last_error: reason.slice(0, 160),
        locked_until: null,
        next_attempt_at: new Date(now.getTime() + delay),
        short_term_exhausted: shortTermExhausted,
        status,
        updated_at: now,
      } },
    );
    return { attemptCount, delay, shortTermExhausted };
  }

  async cancelPrefix(ownerUserId: string, relativePath: string) {
    const escaped = relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await (await this.collection()).deleteMany({
      owner_user_id: ownerUserId,
      relative_path: { $regex: `^${escaped}(?:/|$)` },
    });
  }

  async retargetPrefix(ownerUserId: string, oldRelativePath: string, relativePath: string) {
    const escaped = oldRelativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const collection = await this.collection();
    const jobs = await collection.find({
      owner_user_id: ownerUserId,
      relative_path: { $regex: `^${escaped}(?:/|$)` },
    }).toArray();
    for (const job of jobs) {
      const nextPath = relativePath + job.relative_path.slice(oldRelativePath.length);
      await collection.updateOne(
        { owner_user_id: ownerUserId, relative_path: job.relative_path },
        { $set: { relative_path: nextPath, updated_at: new Date() } },
      );
    }
  }
}

async function driveAccountForOwner(ownerUserId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("google_accounts")
    .select("id, connection_status, granted_scopes")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: true });
  if (error) return { accountId: null, status: "unavailable" as const };
  const authorized = data.filter((account) =>
    account.connection_status === "connected" &&
    account.granted_scopes.includes(GOOGLE_DRIVE_METADATA_READONLY_SCOPE)
  );
  return authorized.length === 1
    ? { accountId: authorized[0].id, status: "ready" as const }
    : {
        accountId: null,
        status: authorized.length > 1 ? "account_required" as const : "auth_required" as const,
      };
}

type AutoReconciliationDependencies = {
  accountForOwner: typeof driveAccountForOwner;
  createResolver: typeof createDriveHierarchyResolver;
  jobs: MongoDriveReconciliationRepository;
  tree: MongoTreeOfLifeRepository;
};

function defaultDependencies(): AutoReconciliationDependencies {
  return {
    accountForOwner: driveAccountForOwner,
    createResolver: createDriveHierarchyResolver,
    jobs: new MongoDriveReconciliationRepository(),
    tree: new MongoTreeOfLifeRepository(),
  };
}

export async function enqueueDriveIdentity(
  ownerUserId: string,
  relativePath: string,
  isBranch: boolean,
  dependencies = defaultDependencies(),
) {
  const [identity] = await dependencies.tree.readDriveFolderIdentitiesForOwner(ownerUserId, [relativePath]);
  if (identity && exactDriveFolderUrl(identity)) {
    await dependencies.jobs.resolve(ownerUserId, relativePath);
    return false;
  }
  await dependencies.jobs.enqueue(ownerUserId, relativePath, isBranch);
  console.info("DRIVE_AUTO_QUEUE", { isBranch, relativePath });
  return true;
}

export async function enqueueUnresolvedDriveBranches(
  ownerUserId: string,
  dependencies = defaultDependencies(),
) {
  const targets = await dependencies.tree.listDriveResolutionTargets(ownerUserId, true);
  for (const target of targets) {
    if (!exactDriveFolderUrl(target)) {
      await dependencies.jobs.enqueue(ownerUserId, target.relativePath, true);
      console.info("DRIVE_AUTO_QUEUE", { isBranch: true, relativePath: target.relativePath });
    }
  }
}

export async function processDriveIdentityQueue(
  ownerUserId: string,
  { limit = 3, now = () => new Date() }: { limit?: number; now?: () => Date } = {},
  dependencies = defaultDependencies(),
) {
  let resolver: Awaited<ReturnType<typeof createDriveHierarchyResolver>> | null = null;
  let account: Awaited<ReturnType<typeof driveAccountForOwner>> | null = null;
  let processed = 0;
  while (processed < limit) {
    const job = await dependencies.jobs.claimDue(ownerUserId, now());
    if (!job) break;
    account ??= await dependencies.accountForOwner(ownerUserId);
    processed += 1;
    console.info("DRIVE_AUTO_ATTEMPT", {
      attempt: job.attempt_count + 1,
      priority: job.priority,
      relativePath: job.relative_path,
    });
    const [cached] = await dependencies.tree.readDriveFolderIdentitiesForOwner(ownerUserId, [job.relative_path]);
    if (cached && exactDriveFolderUrl(cached)) {
      await dependencies.jobs.resolve(ownerUserId, job.relative_path, now());
      console.info("DRIVE_AUTO_RESOLVED", { cached: true, relativePath: job.relative_path });
      continue;
    }
    if (!account.accountId) {
      const retry = await dependencies.jobs.retry(job, "auth_required", account.status, now());
      console.warn("DRIVE_AUTO_AUTH_REQUIRED", { relativePath: job.relative_path, status: account.status });
      console.info("DRIVE_AUTO_RETRY", { delayMs: retry.delay, relativePath: job.relative_path });
      continue;
    }
    try {
      resolver ??= await dependencies.createResolver({
        googleAccountId: account.accountId,
        ownerUserId,
      });
      const result = await resolver.resolve(job.relative_path);
      if (result.status === "resolved") {
        await dependencies.tree.cacheDriveFolderIdentities(ownerUserId, result.folders);
        const [persisted] = await dependencies.tree.readDriveFolderIdentitiesForOwner(
          ownerUserId,
          [job.relative_path],
        );
        if (!persisted || !exactDriveFolderUrl(persisted)) throw new Error("drive_identity_not_persisted");
        await dependencies.jobs.resolve(ownerUserId, job.relative_path, now());
        console.info("DRIVE_AUTO_RESOLVED", { relativePath: job.relative_path });
        continue;
      }
      if (result.status === "ambiguous") {
        const retry = await dependencies.jobs.retry(job, "ambiguous", "ambiguous", now());
        console.warn("DRIVE_AUTO_AMBIGUOUS", {
          candidateCount: result.candidateCount,
          relativePath: job.relative_path,
        });
        console.info("DRIVE_AUTO_RETRY", { delayMs: retry.delay, relativePath: job.relative_path });
        continue;
      }
      if (result.status === "auth_required") {
        const retry = await dependencies.jobs.retry(job, "auth_required", "auth_required", now());
        console.warn("DRIVE_AUTO_AUTH_REQUIRED", { relativePath: job.relative_path });
        console.info("DRIVE_AUTO_RETRY", { delayMs: retry.delay, relativePath: job.relative_path });
        continue;
      }
      const retry = await dependencies.jobs.retry(job, "pending", "not_found", now());
      console.info("DRIVE_AUTO_PENDING", { relativePath: job.relative_path });
      console.info("DRIVE_AUTO_RETRY", { delayMs: retry.delay, relativePath: job.relative_path });
      if (retry.shortTermExhausted) {
        console.info("DRIVE_AUTO_GIVEUP_SHORT_TERM", { relativePath: job.relative_path });
      }
    } catch (error) {
      if (error instanceof GoogleAccountReconnectRequiredError) {
        const retry = await dependencies.jobs.retry(job, "auth_required", "auth_required", now());
        console.warn("DRIVE_AUTO_AUTH_REQUIRED", { relativePath: job.relative_path });
        console.info("DRIVE_AUTO_RETRY", { delayMs: retry.delay, relativePath: job.relative_path });
        if (retry.shortTermExhausted) {
          console.info("DRIVE_AUTO_GIVEUP_SHORT_TERM", { relativePath: job.relative_path });
        }
        continue;
      }
      const retry = await dependencies.jobs.retry(
        job,
        "error",
        error instanceof Error ? error.message : "drive_resolution_failed",
        now(),
      );
      console.warn("DRIVE_AUTO_RETRY", { delayMs: retry.delay, relativePath: job.relative_path });
      if (retry.shortTermExhausted) {
        console.info("DRIVE_AUTO_GIVEUP_SHORT_TERM", { relativePath: job.relative_path });
      }
    }
  }
  return processed;
}

export async function cancelDriveIdentityPrefix(ownerUserId: string, relativePath: string) {
  await new MongoDriveReconciliationRepository().cancelPrefix(ownerUserId, relativePath);
}

export async function retargetDriveIdentityPrefix(
  ownerUserId: string,
  oldRelativePath: string,
  relativePath: string,
) {
  await new MongoDriveReconciliationRepository().retargetPrefix(ownerUserId, oldRelativePath, relativePath);
}

export const DRIVE_RECONCILIATION_COLLECTION = COLLECTION_NAME;
export const DRIVE_RETRY_DELAYS_MS = RETRY_DELAYS_MS;
