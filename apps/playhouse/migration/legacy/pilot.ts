import type { Database, Json } from "../../lib/supabase/database.types";
import type { MappedRecord } from "./mapping";
import {
  PILOT_BATCH_ID,
  PILOT_KIND,
  PILOT_LEGACY_DAYS,
  PILOT_LEGACY_IDS,
} from "./pilot-manifest";

const ALLOWED_PILOT_WARNINGS = new Set([
  "noncanonical_place_preserved",
  "player_requires_contact_resolution",
  "url_scheme_normalized",
]);

export type ExistingPilotPlay = {
  id: string;
  legacy_mongo_id: string | null;
  source_metadata: Json;
};

export type PilotClassification = {
  conflicts: ExistingPilotPlay[];
  existing: ExistingPilotPlay[];
  missingLegacyIds: string[];
};

function metadataObject(value: Json) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : {};
}

export function isPilotBatchMetadata(value: Json, batchId = PILOT_BATCH_ID) {
  const root = metadataObject(value);
  const migration = metadataObject(root.migration ?? null);
  return migration.kind === PILOT_KIND && migration.batch_id === batchId;
}

export function jsonValuesEqual(left: Json, right: Json) {
  const canonicalize = (value: Json): Json => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, child]) => [key, canonicalize(child ?? null)]),
    );
  };
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function validatePilotRecords(records: MappedRecord[]) {
  const expected = new Set(PILOT_LEGACY_IDS);
  const seen = new Set<string>();
  const issues: string[] = [];

  if (records.length !== PILOT_LEGACY_IDS.length) {
    issues.push(
      `Pilot must contain exactly ${PILOT_LEGACY_IDS.length} records; received ${records.length}.`,
    );
  }
  for (const record of records) {
    const manifestIndex = PILOT_LEGACY_IDS.indexOf(
      record.legacy.id as (typeof PILOT_LEGACY_IDS)[number],
    );
    if (!expected.has(record.legacy.id as (typeof PILOT_LEGACY_IDS)[number])) {
      issues.push(`Legacy ID ${record.legacy.id} is not in the locked pilot manifest.`);
    } else if (record.legacy.taskDate?.slice(0, 10) !== PILOT_LEGACY_DAYS[manifestIndex]) {
      issues.push(`Legacy ID ${record.legacy.id} is not in its locked pilot destination.`);
    }
    if (seen.has(record.legacy.id)) {
      issues.push(`Legacy ID ${record.legacy.id} occurs more than once.`);
    }
    seen.add(record.legacy.id);
    if (!record.wouldImport || record.errors.length > 0) {
      issues.push(`Legacy ID ${record.legacy.id} is not a clean documented mapping.`);
    }
    if (record.legacy.taskType !== "H" && record.legacy.taskType !== "S") {
      issues.push(`Legacy ID ${record.legacy.id} is not an H/S Play.`);
    }
    for (const warning of record.warnings) {
      if (!ALLOWED_PILOT_WARNINGS.has(warning.code)) {
        issues.push(`Legacy ID ${record.legacy.id} has unsupported warning ${warning.code}.`);
      }
    }
    if (!record.mapped.placement || !record.mapped.playType || !record.mapped.pushRule) {
      issues.push(`Legacy ID ${record.legacy.id} is missing required mapped values.`);
    }
  }
  for (const id of PILOT_LEGACY_IDS) {
    if (!seen.has(id)) {
      issues.push(`Locked legacy ID ${id} is missing from the pilot source.`);
    }
  }
  return issues;
}

export function classifyExistingPilotPlays(
  existingRows: ExistingPilotPlay[],
): PilotClassification {
  const byLegacyId = new Map(
    existingRows.flatMap((row) =>
      row.legacy_mongo_id ? [[row.legacy_mongo_id, row] as const] : [],
    ),
  );
  const existing: ExistingPilotPlay[] = [];
  const conflicts: ExistingPilotPlay[] = [];
  const missingLegacyIds: string[] = [];

  for (const legacyId of PILOT_LEGACY_IDS) {
    const row = byLegacyId.get(legacyId);
    if (!row) {
      missingLegacyIds.push(legacyId);
    } else if (isPilotBatchMetadata(row.source_metadata)) {
      existing.push(row);
    } else {
      conflicts.push(row);
    }
  }
  return { conflicts, existing, missingLegacyIds };
}

export function migrationSourceMetadata(
  record: MappedRecord,
  batchId: string,
  kind: string,
): Json {
  return {
    migration: {
      batch_id: batchId,
      kind,
      legacy_contact: record.mapped.player
        ? {
            cached_display_name: record.mapped.player.cachedDisplayName,
            email: record.mapped.player.email,
            legacy_contact_id: record.mapped.player.legacyContactId,
          }
        : null,
      legacy_priority_index: record.legacy.priorityIndex,
      ...(record.legacy.taskType === "U" || record.legacy.taskType === "P"
        ? { legacy_headline: true }
        : {}),
    },
    legacy_source: record.legacy.sourceRecord,
    external_ids: {
      event_id: record.mapped.externalIds.eventId,
      last_gmail_message_id: record.mapped.externalIds.lastGmailMessageId,
      long_calendar_id: record.mapped.externalIds.longCalendarId,
      message_id: record.mapped.externalIds.messageId,
      thread_id: record.mapped.externalIds.threadId,
    },
  } satisfies Json;
}

export function pilotSourceMetadata(record: MappedRecord): Json {
  return migrationSourceMetadata(record, PILOT_BATCH_ID, PILOT_KIND);
}

export function pilotPlayInsert(
  record: MappedRecord,
  ownerUserId: string,
  basketId: string | null,
  playerContactId: string | null,
) {
  const placement = record.mapped.placement;
  if (!placement || !record.mapped.playType || !record.mapped.pushRule || !record.mapped.title) {
    throw new Error(`Legacy ID ${record.legacy.id} is not fully mapped.`);
  }

  return {
    basket_id: placement.kind === "basket" ? basketId : null,
    branch: record.mapped.branch,
    created_at: record.legacy.createdDate ?? undefined,
    duration_minutes: record.mapped.durationMinutes,
    legacy_mongo_id: record.legacy.id,
    note: record.mapped.note,
    owner_user_id: ownerUserId,
    place: record.mapped.place,
    play_type: record.mapped.playType,
    player_contact_id: playerContactId,
    push_rule: record.mapped.pushRule,
    scheduled_date: placement.kind === "calendar" ? placement.scheduledDate : null,
    sort_order: record.mapped.sortOrder ?? 0,
    source_metadata: pilotSourceMetadata(record),
    source_type: record.mapped.sourceType ?? "user",
    status: "open" as const,
    title: record.mapped.title,
    updated_at: record.legacy.updatedDate ?? undefined,
    url: record.mapped.url,
  } satisfies Database["public"]["Tables"]["plays"]["Insert"];
}

export function validateRollbackRows(rows: ExistingPilotPlay[], batchId: string) {
  const allowed = new Set<string>(PILOT_LEGACY_IDS);
  return rows.flatMap((row) => {
    if (!row.legacy_mongo_id || !allowed.has(row.legacy_mongo_id)) {
      return [`Play ${row.id} is outside the locked pilot manifest.`];
    }
    if (!isPilotBatchMetadata(row.source_metadata, batchId)) {
      return [`Play ${row.id} does not belong to pilot batch ${batchId}.`];
    }
    return [];
  });
}
