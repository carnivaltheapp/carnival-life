import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { MongoClient } from "mongodb";

import type { Database, Json } from "../../lib/supabase/database.types";
import {
  FULL_BATCH_ID,
  FULL_MIGRATION_KIND,
  UP_BATCH_ID,
  UP_MIGRATION_KIND,
  chunks,
  contactSeed,
  fullPlayInsert,
  parseFullArguments,
  partitionFullRecords,
  requireFullWriteConfirmation,
  validateFullSource,
} from "./full";
import {
  APPROVED_CUTOFF,
  assignRelativeSortOrder,
  mapLegacyRecord,
  type LegacyRecord,
  type MappedRecord,
} from "./mapping";
import { jsonValuesEqual } from "./pilot";
import { verifyTargetUser } from "./pilot-support";

const TARGET_BATCH_SIZE = 75;

function metadataObject(value: Json) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : {};
}

function isCurrentFullBatch(value: Json, batchId: string, kind: string) {
  const migration = metadataObject(metadataObject(value).migration ?? null);
  return migration.kind === kind && migration.batch_id === batchId;
}

async function loadSource(taskTypes: readonly string[]) {
  const uri = process.env.LEGACY_MONGO_URI;
  if (!uri) throw new Error("LEGACY_MONGO_URI is required in repo-root .env.local.");
  const mongo = new MongoClient(uri, {
    readPreference: "secondaryPreferred",
    serverSelectionTimeoutMS: 15_000,
  });
  try {
    await mongo.connect();
    const source = await mongo
      .db("restlandmark")
      .collection<LegacyRecord>("tasks_task")
      .find({
        is_active: true,
        is_deleted: false,
        task_date: { $gte: APPROVED_CUTOFF },
        task_type: { $in: [...taskTypes] },
      })
      .sort({ _id: 1 })
      .toArray();
    const records = source.map(mapLegacyRecord);
    assignRelativeSortOrder(records);
    return records;
  } finally {
    await mongo.close();
  }
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Production full import requires the configured Supabase URL and service-role key.");
  }
  const args = parseFullArguments(process.argv.slice(2));
  requireFullWriteConfirmation(args, new URL(url).host);
  const config =
    args.taskTypes === "up"
      ? {
          batchId: UP_BATCH_ID,
          kind: UP_MIGRATION_KIND,
          taskTypes: ["U", "P"] as const,
        }
      : {
          batchId: FULL_BATCH_ID,
          kind: FULL_MIGRATION_KIND,
          taskTypes: ["H", "S"] as const,
        };
  const ownerUserId = args.targetUserId as string;
  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await verifyTargetUser(supabase, ownerUserId);

  const records = await loadSource(config.taskTypes);
  const sourceValidation = validateFullSource(records, config.taskTypes);
  if (sourceValidation.duplicateIds.length > 0) {
    throw new Error(`Duplicate legacy IDs: ${sourceValidation.duplicateIds.join(", ")}`);
  }
  if (sourceValidation.preservationFailures.length > 0) {
    throw new Error(
      `Complete source_metadata preservation failed for: ${sourceValidation.preservationFailures.join(", ")}`,
    );
  }

  const { importable, skipped } = partitionFullRecords(records);
  const [{ data: basketRows, error: basketError }, { data: accountRows, error: accountError }] =
    await Promise.all([
      supabase.from("baskets").select("id, slug").eq("owner_user_id", ownerUserId),
      supabase
        .from("google_accounts")
        .select("id, connection_status")
        .eq("owner_user_id", ownerUserId)
        .eq("connection_status", "connected"),
    ]);
  if (basketError || accountError) throw new Error("Production Basket/Google-account preflight failed.");
  const baskets = new Map((basketRows ?? []).map((basket) => [basket.slug, basket.id]));
  const requiredBasketSlugs = new Set(
    importable.flatMap((record) =>
      record.mapped.placement?.kind === "basket" ? [record.mapped.placement.basketSlug] : [],
    ),
  );
  const missingBaskets = [...requiredBasketSlugs].filter((slug) => !baskets.has(slug));
  if (missingBaskets.length > 0) {
    throw new Error(`Target user is missing documented Baskets: ${missingBaskets.join(", ")}`);
  }

  const recordsWithPlayers = importable.filter((record) => record.mapped.player);
  if (recordsWithPlayers.length > 0 && (accountRows ?? []).length !== 1) {
    throw new Error("Player migration requires exactly one connected Google account for the target user.");
  }
  const googleAccountId = accountRows?.[0]?.id ?? null;
  const contactSeeds = new Map<string, NonNullable<ReturnType<typeof contactSeed>>>();
  if (googleAccountId) {
    for (const record of recordsWithPlayers) {
      const seed = contactSeed(record, ownerUserId, googleAccountId);
      if (seed && !contactSeeds.has(seed.provider_resource_name)) {
        contactSeeds.set(seed.provider_resource_name, seed);
      }
    }
  }

  const contactIds = [...contactSeeds.keys()];
  const contactsByProviderId = new Map<string, string>();
  for (const group of chunks(contactIds, TARGET_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("contact_references")
      .select("id, provider_resource_name")
      .eq("owner_user_id", ownerUserId)
      .eq("google_account_id", googleAccountId as string)
      .in("provider_resource_name", group);
    if (error) throw new Error("Existing Player reference lookup failed.");
    for (const contact of data ?? []) {
      if (contact.provider_resource_name) contactsByProviderId.set(contact.provider_resource_name, contact.id);
    }
  }
  const missingContactSeeds = [...contactSeeds.values()].filter(
    (seed) => !contactsByProviderId.has(seed.provider_resource_name),
  );
  for (const group of chunks(missingContactSeeds, TARGET_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("contact_references")
      .insert(group)
      .select("id, provider_resource_name");
    if (error || (data?.length ?? 0) !== group.length) {
      throw new Error("Player contact-reference batch creation failed.");
    }
    for (const contact of data ?? []) {
      if (contact.provider_resource_name) contactsByProviderId.set(contact.provider_resource_name, contact.id);
    }
  }
  const unresolvedContacts = contactIds.filter((id) => !contactsByProviderId.has(id));
  if (unresolvedContacts.length > 0) {
    throw new Error(`Player references unresolved: ${unresolvedContacts.join(", ")}`);
  }

  const legacyIds = importable.map((record) => record.legacy.id);
  const existingByLegacyId = new Map<string, { id: string; source_metadata: Json }>();
  for (const group of chunks(legacyIds, TARGET_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("plays")
      .select("id, legacy_mongo_id, source_metadata")
      .eq("owner_user_id", ownerUserId)
      .in("legacy_mongo_id", group);
    if (error) throw new Error("Existing Play idempotency lookup failed.");
    for (const play of data ?? []) {
      if (play.legacy_mongo_id) existingByLegacyId.set(play.legacy_mongo_id, play);
    }
  }
  const conflicts = [...existingByLegacyId.entries()].filter(
    ([, play]) => !isCurrentFullBatch(play.source_metadata, config.batchId, config.kind),
  );
  if (conflicts.length > 0) {
    throw new Error(`Legacy IDs already belong to another migration batch: ${conflicts.map(([id]) => id).join(", ")}`);
  }

  const expectedByLegacyId = new Map<
    string,
    ReturnType<typeof fullPlayInsert>
  >();
  for (const record of importable) {
    const placement = record.mapped.placement;
    const basketId =
      placement?.kind === "basket" ? (baskets.get(placement.basketSlug) ?? null) : null;
    const playerContactId = record.mapped.player
      ? (contactsByProviderId.get(record.mapped.player.legacyContactId) ?? null)
      : null;
    if (record.mapped.player && !playerContactId) {
      throw new Error(`Legacy ID ${record.legacy.id} has no resolved player_contact_id.`);
    }
    expectedByLegacyId.set(
      record.legacy.id,
      fullPlayInsert(record, ownerUserId, basketId, playerContactId, config.batchId, config.kind),
    );
  }

  const missingRecords = importable.filter((record) => !existingByLegacyId.has(record.legacy.id));
  for (const group of chunks(missingRecords, TARGET_BATCH_SIZE)) {
    const inserts = group.map((record) => expectedByLegacyId.get(record.legacy.id) as ReturnType<typeof fullPlayInsert>);
    const { data, error } = await supabase
      .from("plays")
      .insert(inserts)
      .select("id, legacy_mongo_id");
    if (error || (data?.length ?? 0) !== inserts.length) {
      throw new Error(`Play batch insert failed: ${error?.message ?? "row count mismatch"}`);
    }
    for (const play of data ?? []) {
      if (play.legacy_mongo_id) existingByLegacyId.set(play.legacy_mongo_id, { id: play.id, source_metadata: {} });
    }
  }

  const verifiedRows = new Map<string, Database["public"]["Tables"]["plays"]["Row"]>();
  for (const group of chunks(legacyIds, TARGET_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("plays")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .in("legacy_mongo_id", group);
    if (error) throw new Error("Post-import Play verification read failed.");
    for (const play of data ?? []) {
      if (play.legacy_mongo_id) verifiedRows.set(play.legacy_mongo_id, play);
    }
  }
  if (verifiedRows.size !== importable.length) {
    throw new Error(`Post-import verification found ${verifiedRows.size}/${importable.length} Plays.`);
  }
  const comparableKeys = [
    "basket_id",
    "branch",
    "duration_minutes",
    "legacy_mongo_id",
    "note",
    "place",
    "play_type",
    "player_contact_id",
    "push_rule",
    "scheduled_date",
    "sort_order",
    "source_type",
    "status",
    "title",
    "url",
  ] as const;
  for (const [legacyId, expected] of expectedByLegacyId) {
    const actual = verifiedRows.get(legacyId);
    if (
      !actual ||
      comparableKeys.some((key) => (actual[key] ?? null) !== (expected[key] ?? null)) ||
      !jsonValuesEqual(actual.source_metadata, expected.source_metadata)
    ) {
      throw new Error(`Post-import field/source_metadata verification failed for ${legacyId}.`);
    }
  }

  const existingEventPlayIds = new Set<string>();
  const { data: eventRows, error: eventReadError } = await supabase
    .from("play_events")
    .select("play_id")
    .eq("owner_user_id", ownerUserId)
    .eq("correlation_id", config.batchId)
    .eq("event_type", "migration_import");
  if (eventReadError) throw new Error("Migration event-history lookup failed.");
  for (const event of eventRows ?? []) if (event.play_id) existingEventPlayIds.add(event.play_id);
  const missingEvents = [...verifiedRows.values()].filter((play) => !existingEventPlayIds.has(play.id));
  for (const group of chunks(missingEvents, TARGET_BATCH_SIZE)) {
    const { error } = await supabase.from("play_events").insert(
      group.map((play) => ({
        actor_user_id: ownerUserId,
        correlation_id: config.batchId,
        event_type: "migration_import",
        owner_user_id: ownerUserId,
        payload: {
          after: { legacy_mongo_id: play.legacy_mongo_id },
          batch_id: config.batchId,
          migration_kind: config.kind,
        } satisfies Json,
        play_id: play.id,
        source: "migration" as const,
      })),
    );
    if (error) throw new Error(`Migration event batch insert failed: ${error.message}`);
  }

  const basketCounts: Record<string, number> = {};
  const destinationCounts: Record<string, number> = {};
  let calendarDateCount = 0;
  for (const record of importable) {
    const placement = record.mapped.placement;
    if (placement?.kind === "calendar") {
      calendarDateCount += 1;
      destinationCounts[placement.scheduledDate] =
        (destinationCounts[placement.scheduledDate] ?? 0) + 1;
    } else if (placement?.kind === "basket") {
      basketCounts[placement.basketName] = (basketCounts[placement.basketName] ?? 0) + 1;
      destinationCounts[placement.basketName] =
        (destinationCounts[placement.basketName] ?? 0) + 1;
    }
  }
  const result = {
    batchId: config.batchId,
    sourceCandidates: records.length,
    taskTypeCounts: Object.fromEntries(
      config.taskTypes.map((taskType) => [
        taskType,
        records.filter((record) => record.legacy.taskType === taskType).length,
      ]),
    ),
    importedCount: importable.length,
    skippedCount: skipped.length,
    failedCount: 0,
    normalCount: importable.filter((record) => record.mapped.playType === "normal").length,
    reminderCount: importable.filter((record) => record.mapped.playType === "reminder").length,
    calendarDateCount,
    basketCounts,
    destinationCounts,
    playsWithPlayer: importable.filter((record) => record.mapped.player).length,
    playsWithoutPlayer: importable.filter((record) => !record.mapped.player).length,
    emailPlayCount: importable.filter((record) => record.mapped.sourceType === "gmail").length,
    calendarIdCount: importable.filter(
      (record) => record.mapped.externalIds.eventId || record.mapped.externalIds.longCalendarId,
    ).length,
    gmailThreadIdCount: importable.filter((record) => record.mapped.externalIds.threadId).length,
    failures: skipped.map((record) => ({
      legacyId: record.legacy.id,
      reason: record.errors.map((issue) => `${issue.code}: ${issue.message}`).join("; "),
    })),
  };
  const reportDirectory = resolve("migration-reports");
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    resolve(reportDirectory, `legacy-full-import-${config.batchId}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Legacy full import stopped: ${error instanceof Error ? error.message : "Unknown error."}\n`,
  );
  process.exitCode = 1;
});
