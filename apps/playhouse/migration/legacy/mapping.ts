import { BSON } from "mongodb";

import type { Json } from "../../lib/supabase/database.types";

export const APPROVED_CUTOFF = new Date("2026-08-25T00:00:00.000Z");

export const LEGACY_SOURCE_FIELDS = [
  "_id",
  "created_date",
  "updated_date",
  "is_deleted",
  "is_active",
  "user_id",
  "category_id",
  "action_type",
  "first",
  "last",
  "amount",
  "task_date",
  "task_time",
  "task_type",
  "duration",
  "url",
  "phone",
  "ptype",
  "email",
  "etype",
  "contact_id",
  "note",
  "priority_index",
  "old_task_id",
  "push_type",
  "time_task",
  "is_pushed",
  "g_address",
  "branch",
  "event_id",
  "long_id",
  "thread_id",
  "message_id",
  "last_id",
  "place",
  "regarding",
  "task_status",
] as const;

export const LEGACY_BASKETS = {
  "2200-01-01": { name: "On The Way", slug: "on-the-way" },
  "2200-01-02": { name: "To Go", slug: "to-go" },
  "2300-01-01": { name: "In Touch", slug: "in-touch" },
  "2400-01-01": { name: "Soon", slug: "soon" },
  "2400-01-11": { name: "Backlog", slug: "backlog" },
  "2500-01-01": { name: "Later", slug: "later" },
  "2600-01-01": { name: "To Watch", slug: "to-watch" },
} as const;

export type LegacyRecord = Record<string, unknown> & {
  _id?: unknown;
  action_type?: unknown;
  is_active?: unknown;
  is_deleted?: unknown;
  task_date?: unknown;
};

export type Issue = {
  code: string;
  message: string;
};

export type MappedRecord = {
  classification: "importable" | "importable_with_warnings" | "needs_review";
  errors: Issue[];
  legacy: {
    id: string;
    userId: string | null;
    createdDate: string | null;
    updatedDate: string | null;
    taskDate: string | null;
    taskType: string | null;
    taskStatus: string | null;
    priorityIndex: string | null;
    pushType: string | null;
    regarding: string | null;
    sourceDuration: number | null;
    sourcePlace: string | null;
    sourceRecord: Json;
  };
  mapped: {
    legacyMongoId: string;
    title: string | null;
    status: "open";
    playType: "normal" | "reminder" | null;
    placement:
      | { kind: "calendar"; scheduledDate: string }
      | { basketName: string; basketSlug: string; kind: "basket" }
      | null;
    branch: string | null;
    player: {
      cachedDisplayName: string | null;
      email: string | null;
      legacyContactId: string;
      resolution: "legacy_contact_reference_required";
    } | null;
    note: string | null;
    url: string | null;
    durationMinutes: number | null;
    pushRule: "everyday" | "weekdays" | "weekends" | null;
    place: string | null;
    sortOrder: number | null;
    sourceType: "gmail" | "user" | null;
    externalIds: {
      eventId: string | null;
      lastGmailMessageId: string | null;
      longCalendarId: string | null;
      messageId: string | null;
      threadId: string | null;
    };
    workflow: {
      isWaiting: boolean;
      legacyTaskStatus: string | null;
      nextLegacyPlayId: null;
    };
  };
  warnings: Issue[];
  wouldImport: boolean;
};

export function serializeLegacySourceRecord(record: LegacyRecord): Json {
  const serialized = BSON.EJSON.serialize(record, { relaxed: false }) as Record<string, Json>;
  for (const field of LEGACY_SOURCE_FIELDS) {
    if (!Object.hasOwn(serialized, field)) {
      serialized[field] = null;
    }
  }
  return serialized;
}

function text(record: LegacyRecord, key: string) {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  const result = String(value).trim();
  return result || null;
}

function isoDate(value: unknown) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return value.toISOString();
}

function calendarDay(value: unknown) {
  return isoDate(value)?.slice(0, 10) ?? null;
}

export function isApprovedCandidate(record: LegacyRecord) {
  return (
    record.is_active === true &&
    record.is_deleted === false &&
    record.task_date instanceof Date &&
    !Number.isNaN(record.task_date.getTime()) &&
    record.task_date >= APPROVED_CUTOFF
  );
}

function mappedUrl(value: string | null, warnings: Issue[]) {
  if (!value) {
    return null;
  }

  const normalized = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
      throw new Error("unsupported URL");
    }
    if (normalized !== value) {
      warnings.push({
        code: "url_scheme_normalized",
        message: "URL would be normalized with an https:// scheme.",
      });
    }
    return normalized;
  } catch {
    warnings.push({
      code: "invalid_url_omitted",
      message: "Legacy URL is not a valid HTTP(S) URL and would be omitted.",
    });
    return null;
  }
}

export function mapLegacyRecord(record: LegacyRecord): MappedRecord {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const id = text(record, "_id") ?? "";
  const title = text(record, "action_type");
  const day = calendarDay(record.task_date);
  const taskType = text(record, "task_type");

  if (!id) {
    errors.push({ code: "missing_legacy_id", message: "Legacy _id is required." });
  }
  if (!title) {
    errors.push({ code: "missing_title", message: "Play title is required." });
  }
  if (!isApprovedCandidate(record)) {
    errors.push({
      code: "outside_approved_population",
      message: "Record does not satisfy the approved active/non-deleted/date filter.",
    });
  }

  let placement: MappedRecord["mapped"]["placement"] = null;
  if (day && day in LEGACY_BASKETS) {
    const basket = LEGACY_BASKETS[day as keyof typeof LEGACY_BASKETS];
    placement = { basketName: basket.name, basketSlug: basket.slug, kind: "basket" };
  } else if (day && day < "2100-01-01") {
    placement = { kind: "calendar", scheduledDate: day };
  } else if (day) {
    errors.push({
      code: "unsupported_basket_date",
      message: `Legacy Basket sentinel ${day} is not a supported Phase 1 mapping.`,
    });
  } else {
    errors.push({ code: "invalid_task_date", message: "task_date is missing or invalid." });
  }

  const playType = taskType === "H" ? "normal" : taskType === "S" ? "reminder" : null;
  if (!playType) {
    errors.push({
      code: "unsupported_task_type",
      message: `Legacy task_type ${taskType ?? "(blank)"} is not safely Normal/Reminder.`,
    });
  }

  const pushType = text(record, "push_type");
  const pushRule =
    pushType === "Everyday"
      ? "everyday"
      : pushType === "Weekday"
        ? "weekdays"
        : pushType === "Weekend"
          ? "weekends"
          : null;
  if (!pushRule) {
    errors.push({
      code: "unsupported_push_rule",
      message: `Legacy push_type ${pushType ?? "(blank)"} has no safe current mapping.`,
    });
  }

  const rawDuration = record.duration;
  let durationMinutes: number | null = null;
  if (playType === "normal") {
    if (
      typeof rawDuration === "number" &&
      Number.isInteger(rawDuration) &&
      rawDuration >= 1 &&
      rawDuration <= 1440
    ) {
      durationMinutes = rawDuration;
    } else {
      errors.push({
        code: "invalid_duration",
        message: "Normal Play duration must be a whole number from 1 to 1,440.",
      });
    }
  }

  const regarding = text(record, "regarding");
  const sourceType = regarding === "email" ? "gmail" : regarding === "user" ? "user" : null;
  if (!sourceType) {
    errors.push({
      code: "unsupported_source_type",
      message: `Legacy regarding ${regarding ?? "(blank)"} is not safely user/email.`,
    });
  }

  const legacyContactId = text(record, "contact_id");
  const first = text(record, "first");
  const last = text(record, "last");
  const cachedDisplayName = [first, last].filter(Boolean).join(" ") || text(record, "contact_name");
  const player = legacyContactId
    ? {
        cachedDisplayName: cachedDisplayName || null,
        email: text(record, "email"),
        legacyContactId,
        resolution: "legacy_contact_reference_required" as const,
      }
    : null;
  if (player) {
    warnings.push({
      code: "player_requires_contact_resolution",
      message: "Opaque legacy contact ID must be resolved/upserted before a Play UUID can reference it.",
    });
  }

  const lowerBranch = text(record, "branch");
  const upperBranch = text(record, "Branch");
  if (!lowerBranch && upperBranch) {
    warnings.push({
      code: "uppercase_branch_field",
      message: "Branch was recovered from the one observed uppercase legacy field variant.",
    });
  }

  const place = text(record, "place");
  if (place && !["office", "outside", "any"].includes(place)) {
    warnings.push({
      code: "noncanonical_place_preserved",
      message: "Noncanonical legacy Place would be preserved for review.",
    });
  }

  const mapped: MappedRecord["mapped"] = {
    branch: lowerBranch ?? upperBranch,
    durationMinutes,
    externalIds: {
      eventId: text(record, "event_id"),
      lastGmailMessageId: text(record, "last_id"),
      longCalendarId: text(record, "long_id"),
      messageId: text(record, "message_id"),
      threadId: text(record, "thread_id"),
    },
    legacyMongoId: id,
    note: text(record, "note"),
    place,
    placement,
    playType,
    player,
    pushRule,
    sortOrder: null,
    sourceType,
    status: "open",
    title,
    url: mappedUrl(text(record, "url"), warnings),
    workflow: {
      isWaiting: playType === "reminder",
      legacyTaskStatus: text(record, "task_status"),
      nextLegacyPlayId: null,
    },
  };

  return {
    classification:
      errors.length > 0
        ? "needs_review"
        : warnings.length > 0
          ? "importable_with_warnings"
          : "importable",
    errors,
    legacy: {
      createdDate: isoDate(record.created_date),
      id,
      priorityIndex: text(record, "priority_index"),
      pushType,
      regarding,
      sourceDuration: typeof rawDuration === "number" ? rawDuration : null,
      sourcePlace: place,
      sourceRecord: serializeLegacySourceRecord(record),
      taskDate: isoDate(record.task_date),
      taskStatus: text(record, "task_status"),
      taskType,
      updatedDate: isoDate(record.updated_date),
      userId: text(record, "user_id"),
    },
    mapped,
    warnings,
    wouldImport: errors.length === 0,
  };
}

export function findDuplicateLegacyIds(records: MappedRecord[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.legacy.id, (counts.get(record.legacy.id) ?? 0) + 1);
  }
  return Array.from(counts).filter(([id, count]) => Boolean(id) && count > 1).map(([id]) => id);
}

export function assignRelativeSortOrder(records: MappedRecord[]) {
  const groups = new Map<string, MappedRecord[]>();
  for (const record of records) {
    const placement = record.mapped.placement;
    if (!placement) continue;
    const key =
      placement.kind === "calendar"
        ? `date:${placement.scheduledDate}`
        : `basket:${placement.basketSlug}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  for (const group of groups.values()) {
    group
      .sort((left, right) =>
        (left.legacy.priorityIndex ?? "").localeCompare(right.legacy.priorityIndex ?? "") ||
        (left.legacy.createdDate ?? "").localeCompare(right.legacy.createdDate ?? "") ||
        left.legacy.id.localeCompare(right.legacy.id),
      )
      .forEach((record, index) => {
        record.mapped.sortOrder = (index + 1) * 1000;
      });
  }
}
