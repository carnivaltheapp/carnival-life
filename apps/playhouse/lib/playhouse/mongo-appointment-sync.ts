import { type Collection, type Filter } from "mongodb";

import type { MappedGoogleAppointment } from "../google/appointment-events";
import {
  MONGO_LEGACY_USER_ID,
  nextLegacyPriorityIndex,
  type LegacyTaskDocument,
} from "./mongo-play-mapping";

export type GoogleAppointmentIdentity = {
  googleAccountId: string;
  googleCalendarId: string;
};

export type AppointmentSyncResult = {
  failed: Array<{ eventId: string | null; reason: string }>;
  imported: number;
  inactivated: number;
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
    "carnival_google.start": event.start,
    "carnival_google.status": event.status,
    "carnival_google.time_zone": event.timeZone,
  };
}

function appointmentSet(
  identity: GoogleAppointmentIdentity,
  event: MappedGoogleAppointment,
  now: Date,
) {
  return {
    action_type: event.title,
    duration: event.durationMinutes,
    event_id: event.eventId,
    is_active: true,
    is_deleted: false,
    task_date: new Date(`${event.scheduledDate}T00:00:00.000Z`),
    task_time: event.taskTime,
    task_type: "A",
    updated_date: now,
    ...googleMetadataSet(identity, event),
  };
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

async function findExisting(
  collection: Collection<LegacyTaskDocument>,
  identity: GoogleAppointmentIdentity,
  eventId: string,
) {
  const exact = await collection.findOne(identityFilter(identity, eventId));
  if (exact) return { document: exact, safe: true };

  const legacy = await collection
    .find({ event_id: eventId, task_type: "A", user_id: MONGO_LEGACY_USER_ID })
    .limit(2)
    .toArray();
  return legacy.length === 1
    ? { document: legacy[0], safe: true }
    : { document: null, safe: legacy.length === 0 };
}

export async function synchronizeMongoAppointments({
  collection,
  events,
  identity,
  now = new Date(),
}: {
  collection: Collection<LegacyTaskDocument>;
  events: Array<MappedGoogleAppointment | null>;
  identity: GoogleAppointmentIdentity;
  now?: Date;
}): Promise<AppointmentSyncResult> {
  const result: AppointmentSyncResult = {
    failed: [],
    imported: 0,
    inactivated: 0,
    unchanged: 0,
    updated: 0,
  };

  for (const event of events) {
    if (!event) {
      result.failed.push({ eventId: null, reason: "Malformed Google event." });
      continue;
    }

    try {
      const existing = await findExisting(collection, identity, event.eventId);
      if (!existing.safe) {
        result.failed.push({
          eventId: event.eventId,
          reason: "Multiple legacy Appointments share this Google event ID.",
        });
        continue;
      }

      if (event.status === "cancelled") {
        if (!existing.document) {
          result.unchanged += 1;
          continue;
        }
        const update = await collection.updateOne(
          { _id: existing.document._id, user_id: MONGO_LEGACY_USER_ID },
          {
            $set: {
              is_active: false,
              updated_date: now,
              ...googleMetadataSet(identity, event),
            },
          },
        );
        if (update.matchedCount !== 1) throw new Error("Appointment was not found.");
        result.inactivated += update.modifiedCount ? 1 : 0;
        result.unchanged += update.modifiedCount ? 0 : 1;
        continue;
      }

      if (existing.document?._id) {
        const update = await collection.updateOne(
          { _id: existing.document._id, user_id: MONGO_LEGACY_USER_ID },
          { $set: appointmentSet(identity, event, now) },
        );
        if (update.matchedCount !== 1) throw new Error("Appointment was not found.");
        result.updated += update.modifiedCount ? 1 : 0;
        result.unchanged += update.modifiedCount ? 0 : 1;
        continue;
      }

      const taskDate = new Date(`${event.scheduledDate}T00:00:00.000Z`);
      const latest = await collection.findOne(
        {
          is_active: true,
          is_deleted: false,
          task_date: taskDate,
          task_type: "A",
          user_id: MONGO_LEGACY_USER_ID,
        },
        { projection: { priority_index: 1 }, sort: { priority_index: -1 } },
      );
      const document = newAppointmentDocument({
        event,
        now,
        priorityIndex: nextLegacyPriorityIndex(latest?.priority_index),
      });
      const upsert = await collection.updateOne(
        identityFilter(identity, event.eventId),
        {
          $set: googleMetadataSet(identity, event),
          $setOnInsert: document,
        },
        { upsert: true },
      );
      result.imported += upsert.upsertedCount ? 1 : 0;
      result.unchanged += upsert.upsertedCount ? 0 : 1;
    } catch {
      result.failed.push({ eventId: event.eventId, reason: "Mongo synchronization failed." });
    }
  }

  return result;
}

export function appointmentMongoIdentityFilter(
  identity: GoogleAppointmentIdentity,
  eventId: string,
) {
  return identityFilter(identity, eventId);
}
