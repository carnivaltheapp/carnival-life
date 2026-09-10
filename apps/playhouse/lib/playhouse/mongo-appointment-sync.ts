import {
  type AnyBulkWriteOperation,
  type Collection,
  type Filter,
  type WithId,
} from "mongodb";

import type {
  GoogleInputCalendarRole,
  MappedGoogleAppointment,
} from "../google/appointment-events";
import {
  legacyPriorityNumber,
  MONGO_LEGACY_USER_ID,
  nextLegacyPriorityIndex,
  type LegacyTaskDocument,
} from "./mongo-play-mapping";

export type GoogleAppointmentIdentity = {
  googleAccountId: string;
  googleCalendarId: string;
  semanticRole?: GoogleInputCalendarRole;
};

export type AppointmentSyncResult = {
  failed: Array<{ eventId: string | null; reason: string }>;
  imported: number;
  inactivated: number;
  mongoReads: number;
  mongoWriteBatches: number;
  mongoWrites: number;
  unchanged: number;
  updated: number;
};

function identityFilter(
  identity: GoogleAppointmentIdentity,
  eventId: string,
): Filter<LegacyTaskDocument> {
  return {
    "carnival_google.account_id": identity.googleAccountId,
    "carnival_google.calendar_id": identity.googleCalendarId,
    "carnival_google.event_id": eventId,
    user_id: MONGO_LEGACY_USER_ID,
  };
}

function googleMetadataSet(
  identity: GoogleAppointmentIdentity,
  event: MappedGoogleAppointment,
) {
  return {
    "carnival_google.account_id": identity.googleAccountId,
    "carnival_google.all_day": event.allDay,
    "carnival_google.calendar_id": identity.googleCalendarId,
    "carnival_google.end": event.end,
    "carnival_google.event_id": event.eventId,
    "carnival_google.event_updated_at": event.googleUpdatedAt,
    "carnival_google.semantic_role": identity.semanticRole ?? "appointment",
    "carnival_google.start": event.start,
    "carnival_google.status": event.status,
    "carnival_google.time_zone": event.timeZone,
  };
}

function appointmentOwnedSet(
  identity: GoogleAppointmentIdentity,
  event: MappedGoogleAppointment,
) {
  return {
    action_type: event.title,
    duration: event.durationMinutes,
    event_id: event.eventId,
    task_date: new Date(`${event.scheduledDate}T00:00:00.000Z`),
    task_time: event.taskTime,
    task_type: "A",
    ...googleMetadataSet(identity, event),
  } satisfies Record<string, unknown>;
}

function newAppointmentDocument({
  event,
  now,
  priorityIndex,
}: {
  event: MappedGoogleAppointment;
  now: Date;
  priorityIndex: string;
}): LegacyTaskDocument {
  return {
    action_type: event.title,
    amount: "",
    branch: "",
    category_id: "",
    contact_id: "",
    created_date: now,
    duration: event.durationMinutes,
    email: "",
    etype: "",
    event_id: event.eventId,
    first: "",
    g_address: "",
    is_active: true,
    is_deleted: false,
    is_pushed: false,
    last: "",
    last_id: "",
    message_id: "",
    note: "",
    old_task_id: "",
    phone: "",
    place: "",
    priority_index: priorityIndex,
    ptype: "",
    push_type: "Everyday",
    regarding: "user",
    task_date: new Date(`${event.scheduledDate}T00:00:00.000Z`),
    task_status: "",
    task_time: event.taskTime,
    task_type: "A",
    thread_id: "",
    time_task: !event.allDay,
    updated_date: now,
    url: "",
    user_id: MONGO_LEGACY_USER_ID,
  };
}

function dottedValue(document: LegacyTaskDocument, path: string) {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, document);
}

function sameValue(left: unknown, right: unknown) {
  return left instanceof Date && right instanceof Date
    ? left.getTime() === right.getTime()
    : left === right;
}

function changedSet(
  document: LegacyTaskDocument,
  desired: Record<string, unknown>,
) {
  return Object.fromEntries(
    Object.entries(desired).filter(([path, value]) =>
      !sameValue(dottedValue(document, path), value)),
  );
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateKey(value: unknown) {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value.toISOString().slice(0, 10)
    : null;
}

function pushByEventId(
  map: Map<string, WithId<LegacyTaskDocument>[]>,
  eventId: string | null,
  document: WithId<LegacyTaskDocument>,
) {
  if (!eventId) return;
  map.set(eventId, [...(map.get(eventId) ?? []), document]);
}

function isLinkedToCalendar(
  document: LegacyTaskDocument,
  identity: GoogleAppointmentIdentity,
) {
  return dottedValue(document, "carnival_google.account_id") === identity.googleAccountId &&
    dottedValue(document, "carnival_google.calendar_id") === identity.googleCalendarId;
}

export async function synchronizeMongoAppointments({
  collection,
  endDateExclusive,
  events,
  identity,
  now = new Date(),
  startDate,
}: {
  collection: Collection<LegacyTaskDocument>;
  endDateExclusive: string;
  events: Array<MappedGoogleAppointment | null>;
  identity: GoogleAppointmentIdentity;
  now?: Date;
  startDate: string;
}): Promise<AppointmentSyncResult> {
  const result: AppointmentSyncResult = {
    failed: [],
    imported: 0,
    inactivated: 0,
    mongoReads: 0,
    mongoWriteBatches: 0,
    mongoWrites: 0,
    unchanged: 0,
    updated: 0,
  };
  const validEvents = new Map<string, MappedGoogleAppointment>();
  for (const event of events) {
    if (!event) {
      result.failed.push({ eventId: null, reason: "Malformed Google event." });
    } else {
      validEvents.set(event.eventId, event);
    }
  }

  const eventIds = [...validEvents.keys()];
  const taskDateRange = {
    $gte: new Date(`${startDate}T00:00:00.000Z`),
    $lt: new Date(`${endDateExclusive}T00:00:00.000Z`),
  };
  const existingDocuments = await collection.find({
    is_deleted: { $ne: true },
    task_type: "A",
    user_id: MONGO_LEGACY_USER_ID,
    $or: [
      { task_date: taskDateRange },
      ...(eventIds.length ? [
        { event_id: { $in: eventIds } },
        {
          "carnival_google.account_id": identity.googleAccountId,
          "carnival_google.calendar_id": identity.googleCalendarId,
          "carnival_google.event_id": { $in: eventIds },
        },
      ] : []),
    ],
  }).toArray();
  result.mongoReads = 1;

  const exactByEventId = new Map<string, WithId<LegacyTaskDocument>[]>();
  const legacyByEventId = new Map<string, WithId<LegacyTaskDocument>[]>();
  const latestPriorityByDate = new Map<string, { order: number; value: string }>();
  for (const document of existingDocuments) {
    const carnivalEventId = text(dottedValue(document, "carnival_google.event_id"));
    if (!carnivalEventId) {
      pushByEventId(legacyByEventId, text(document.event_id), document);
    }
    if (isLinkedToCalendar(document, identity)) {
      pushByEventId(
        exactByEventId,
        carnivalEventId,
        document,
      );
    }
    const day = dateKey(document.task_date);
    const priority = text(document.priority_index);
    if (day && priority) {
      const order = legacyPriorityNumber(priority, 0);
      if (!latestPriorityByDate.has(day) || order > latestPriorityByDate.get(day)!.order) {
        latestPriorityByDate.set(day, { order, value: priority });
      }
    }
  }

  const operations: AnyBulkWriteOperation<LegacyTaskDocument>[] = [];
  const returnedEventIds = new Set(validEvents.keys());
  let plannedImports = 0;

  for (const event of validEvents.values()) {
    const exact = exactByEventId.get(event.eventId) ?? [];
    const legacy = legacyByEventId.get(event.eventId) ?? [];
    if (exact.length > 1 || (exact.length === 0 && legacy.length > 1)) {
      result.failed.push({
        eventId: event.eventId,
        reason: "Multiple legacy Appointments share this Google event ID.",
      });
      continue;
    }
    const existing = exact[0] ?? legacy[0] ?? null;

    if (event.status === "cancelled") {
      if (!existing || existing.is_active === false) {
        result.unchanged += 1;
        continue;
      }
      operations.push({
        updateOne: {
          filter: { _id: existing._id, user_id: MONGO_LEGACY_USER_ID },
          update: {
            $set: {
              ...changedSet(existing, googleMetadataSet(identity, event)),
              is_active: false,
              updated_date: now,
            },
          },
        },
      });
      result.inactivated += 1;
      continue;
    }

    if (existing) {
      const desired: Record<string, unknown> = appointmentOwnedSet(identity, event);
      const previousGoogleStatus = dottedValue(existing, "carnival_google.status");
      if (
        existing.is_active === false &&
        (previousGoogleStatus === "cancelled" || previousGoogleStatus === "missing")
      ) {
        desired.is_active = true;
      }
      const changes = changedSet(existing, desired);
      if (!Object.keys(changes).length) {
        result.unchanged += 1;
        continue;
      }
      operations.push({
        updateOne: {
          filter: { _id: existing._id, user_id: MONGO_LEGACY_USER_ID },
          update: { $set: { ...changes, updated_date: now } },
        },
      });
      result.updated += 1;
      continue;
    }

    const previousPriority = latestPriorityByDate.get(event.scheduledDate)?.value;
    const priorityIndex = nextLegacyPriorityIndex(previousPriority);
    latestPriorityByDate.set(event.scheduledDate, {
      order: legacyPriorityNumber(priorityIndex, 0),
      value: priorityIndex,
    });
    operations.push({
      updateOne: {
        filter: identityFilter(identity, event.eventId),
        update: {
          $set: googleMetadataSet(identity, event),
          $setOnInsert: newAppointmentDocument({ event, now, priorityIndex }),
        },
        upsert: true,
      },
    });
    plannedImports += 1;
  }

  for (const document of existingDocuments) {
    const eventId = text(dottedValue(document, "carnival_google.event_id"));
    const taskDate = document.task_date;
    if (
      !eventId ||
      !isLinkedToCalendar(document, identity) ||
      returnedEventIds.has(eventId) ||
      document.is_active === false ||
      !(taskDate instanceof Date) ||
      taskDate < taskDateRange.$gte ||
      taskDate >= taskDateRange.$lt
    ) {
      continue;
    }
    operations.push({
      updateOne: {
        filter: { _id: document._id, user_id: MONGO_LEGACY_USER_ID },
        update: {
          $set: {
            "carnival_google.status": "missing",
            is_active: false,
            updated_date: now,
          },
        },
      },
    });
    result.inactivated += 1;
  }

  if (operations.length) {
    const write = await collection.bulkWrite(operations, { ordered: false });
    result.mongoWriteBatches = 1;
    result.mongoWrites = operations.length;
    result.imported = write.upsertedCount;
    result.unchanged += plannedImports - write.upsertedCount;
  }

  return result;
}

export function appointmentMongoIdentityFilter(
  identity: GoogleAppointmentIdentity,
  eventId: string,
) {
  return identityFilter(identity, eventId);
}
