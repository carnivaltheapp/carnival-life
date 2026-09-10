import { ObjectId, type Collection } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import type { MappedGoogleAppointment } from "../google/appointment-events";
import { synchronizeMongoAppointments } from "./mongo-appointment-sync";
import type { LegacyTaskDocument } from "./mongo-play-mapping";

const identity = {
  googleAccountId: "account-1",
  googleCalendarId: "events@example.test",
  semanticRole: "event" as const,
};
const syncWindow = {
  endDateExclusive: "2026-12-08",
  identity,
  startDate: "2026-09-08",
};

function event(overrides: Partial<MappedGoogleAppointment> = {}): MappedGoogleAppointment {
  return {
    allDay: false,
    durationMinutes: 60,
    end: "2026-09-08T19:00:00.000Z",
    eventId: "event-1",
    googleUpdatedAt: "2026-09-07T20:00:00Z",
    scheduledDate: "2026-09-08",
    start: "2026-09-08T18:00:00.000Z",
    status: "confirmed",
    taskTime: new Date("2026-09-08T18:00:00.000Z"),
    timeZone: "America/Los_Angeles",
    title: "Concert",
    ...overrides,
  };
}

function syncedEvent(overrides: LegacyTaskDocument = {}): LegacyTaskDocument {
  return {
    _id: new ObjectId(),
    action_type: "Concert",
    carnival_google: {
      account_id: "account-1",
      all_day: false,
      calendar_id: "events@example.test",
      end: "2026-09-08T19:00:00.000Z",
      event_id: "event-1",
      event_updated_at: "2026-09-07T20:00:00Z",
      semantic_role: "event",
      start: "2026-09-08T18:00:00.000Z",
      status: "confirmed",
      time_zone: "America/Los_Angeles",
    },
    duration: 60,
    event_id: "event-1",
    is_active: true,
    is_deleted: false,
    note: "preserve",
    priority_index: "10-00000128",
    task_date: new Date("2026-09-08T00:00:00.000Z"),
    task_time: new Date("2026-09-08T18:00:00.000Z"),
    task_type: "A",
    user_id: 43,
    ...overrides,
  };
}

function collectionWith(documents: LegacyTaskDocument[], upsertedCount = 0) {
  const bulkWrite = vi.fn().mockResolvedValue({ upsertedCount });
  const find = vi.fn(() => ({ toArray: async () => documents }));
  return {
    bulkWrite,
    collection: { bulkWrite, find } as unknown as Collection<LegacyTaskDocument>,
    find,
  };
}

describe("Mongo AT_Events synchronization", () => {
  it("batches timed and all-day Events as fixed constraints with their actual intervals", async () => {
    const mock = collectionWith([], 2);
    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [
        event(),
        event({
          allDay: true,
          durationMinutes: 1440,
          end: "2026-09-10",
          eventId: "all-day-1",
          scheduledDate: "2026-09-09",
          start: "2026-09-09",
          taskTime: "",
          title: "Festival",
        }),
      ],
      ...syncWindow,
    });

    expect(mock.find).toHaveBeenCalledTimes(1);
    expect(mock.bulkWrite).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ imported: 2, mongoReads: 1, mongoWriteBatches: 1 });
    const operations = mock.bulkWrite.mock.calls[0][0];
    expect(operations[0].updateOne.update.$set).toMatchObject({
      "carnival_google.end": "2026-09-08T19:00:00.000Z",
      "carnival_google.semantic_role": "event",
      "carnival_google.start": "2026-09-08T18:00:00.000Z",
    });
    expect(operations[0].updateOne.update.$setOnInsert).toMatchObject({
      task_type: "A",
      time_task: true,
    });
    expect(operations[1].updateOne.update.$set).toMatchObject({
      "carnival_google.all_day": true,
      "carnival_google.end": "2026-09-10",
      "carnival_google.start": "2026-09-09",
    });
    expect(operations[1].updateOne.update.$setOnInsert).toMatchObject({
      duration: 1440,
      task_time: "",
      time_task: false,
    });
  });

  it("is idempotent for the same account, calendar, and Google event", async () => {
    const mock = collectionWith([syncedEvent()]);
    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [event()],
      ...syncWindow,
    });

    expect(result).toMatchObject({ imported: 0, unchanged: 1, updated: 0 });
    expect(mock.bulkWrite).not.toHaveBeenCalled();
  });

  it("updates only changed Google-owned Event fields", async () => {
    const existing = syncedEvent();
    const mock = collectionWith([existing]);
    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [event({
        durationMinutes: 90,
        end: "2026-09-08T20:30:00.000Z",
        start: "2026-09-08T19:00:00.000Z",
        taskTime: new Date("2026-09-08T19:00:00.000Z"),
        title: "Concert updated",
      })],
      ...syncWindow,
    });

    expect(result.updated).toBe(1);
    const operation = mock.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.filter).toEqual({ _id: existing._id, user_id: 43 });
    expect(operation.update.$set).toMatchObject({
      action_type: "Concert updated",
      duration: 90,
      task_time: new Date("2026-09-08T19:00:00.000Z"),
    });
    expect(operation.update.$set).not.toHaveProperty("note");
  });

  it("marks a cancelled Event inactive without deleting it", async () => {
    const existing = syncedEvent();
    const mock = collectionWith([existing]);
    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [event({ durationMinutes: 0, end: "", start: "", status: "cancelled" })],
      ...syncWindow,
    });

    expect(result.inactivated).toBe(1);
    const update = mock.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(update).toMatchObject({ is_active: false });
    expect(update).not.toHaveProperty("is_deleted");
  });
});
