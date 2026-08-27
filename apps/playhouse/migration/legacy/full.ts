import type { Database, Json } from "../../lib/supabase/database.types";
import { LEGACY_SOURCE_FIELDS, type MappedRecord } from "./mapping";
import { migrationSourceMetadata, pilotPlayInsert } from "./pilot";

export const FULL_BATCH_ID = "36e5f6af-49fd-4bdb-aad0-6e0639117156";
export const FULL_MIGRATION_KIND = "legacy_play_full";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FullArguments = {
  confirmHost: string | null;
  targetUserId: string | null;
  write: boolean;
};

export function parseFullArguments(args: string[]): FullArguments {
  const parsed: FullArguments = { confirmHost: null, targetUserId: null, write: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--write") parsed.write = true;
    else if (argument === "--confirm-supabase-host") parsed.confirmHost = args[++index] ?? null;
    else if (argument === "--target-user-id") parsed.targetUserId = args[++index] ?? null;
    else throw new Error(`Unsupported full-import option: ${argument}`);
  }
  return parsed;
}

export function requireFullWriteConfirmation(args: FullArguments, actualHost: string) {
  if (!args.write) throw new Error("Production full import requires the explicit --write flag.");
  if (!args.targetUserId || !UUID_PATTERN.test(args.targetUserId)) {
    throw new Error("Provide the explicit production Carnival UUID with --target-user-id.");
  }
  if (args.confirmHost !== actualHost) {
    throw new Error(`Confirm the exact destination with --confirm-supabase-host ${actualHost}.`);
  }
}

export function validateFullSource(records: MappedRecord[]) {
  const duplicateIds = new Set<string>();
  const seen = new Set<string>();
  const unsupportedBaskets: Array<{ id: string; reason: string }> = [];
  const preservationFailures: string[] = [];
  for (const record of records) {
    if (seen.has(record.legacy.id)) duplicateIds.add(record.legacy.id);
    seen.add(record.legacy.id);
    if (record.legacy.taskType !== "H" && record.legacy.taskType !== "S") {
      throw new Error(`Source filter admitted non-H/S legacy ID ${record.legacy.id}.`);
    }
    const basketIssue = record.errors.find((issue) => issue.code === "unsupported_basket_date");
    if (basketIssue) unsupportedBaskets.push({ id: record.legacy.id, reason: basketIssue.message });
    const source = record.legacy.sourceRecord;
    if (
      typeof source !== "object" ||
      source === null ||
      Array.isArray(source) ||
      LEGACY_SOURCE_FIELDS.some((field) => !Object.hasOwn(source, field))
    ) {
      preservationFailures.push(record.legacy.id);
    }
  }
  return {
    duplicateIds: [...duplicateIds],
    preservationFailures,
    unsupportedBaskets,
  };
}

export function fullSourceMetadata(record: MappedRecord): Json {
  return migrationSourceMetadata(record, FULL_BATCH_ID, FULL_MIGRATION_KIND);
}

export function fullPlayInsert(
  record: MappedRecord,
  ownerUserId: string,
  basketId: string | null,
  playerContactId: string | null,
) {
  return {
    ...pilotPlayInsert(record, ownerUserId, basketId, playerContactId),
    source_metadata: fullSourceMetadata(record),
  } satisfies Database["public"]["Tables"]["plays"]["Insert"];
}

export function contactSeed(record: MappedRecord, ownerUserId: string, googleAccountId: string) {
  const player = record.mapped.player;
  if (!player) return null;
  const source = record.legacy.sourceRecord as Record<string, Json | undefined>;
  const sourcePhone = typeof source.phone === "string" ? source.phone.trim() : "";
  return {
    display_name:
      player.cachedDisplayName?.trim() ||
      player.email?.trim() ||
      sourcePhone ||
      player.legacyContactId,
    email: player.email,
    google_account_id: googleAccountId,
    owner_user_id: ownerUserId,
    provider_resource_name: player.legacyContactId,
  } satisfies Database["public"]["Tables"]["contact_references"]["Insert"];
}

export function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}
