import { ObjectId, type Collection } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import type { MappedGoogleAppointment } from "../google/appointment-events";
import {
  appointmentMongoIdentityFilter,
  synchronizeMongoAppointments,
} from "./mongo-appointment-sync";
import type { LegacyTaskDocument } from "./mongo-play-mapping";

const identity = {
  googleAccountId: "account-1",
  googleCalendarId: "appointments@example.test",
};
const syncArguments = {
  endDateExclusive: "2026-12-08",
  identity,
  startDate: "2026-09-08",
};

function event(overrides: Partial<MappedGoogleAppointment> = {}): MappedGoogleAppointment {
  return {
    allDay: false,
    durationMinutes: 45,
    end: "2026-09-08T18:45:00.000Z",
    eventId: "event-1",
    googleUpdatedAt: "2026-09-06T18:00:00Z",
    scheduledDate: "2026-09-08",
    start: "2026-09-08T18:00:00.000Z",
    status: "confirmed",
    taskTime: new Date("2026-09-08T18:00:00.000Z"),
    timeZone: "America/Los_Angeles",
    title: "Google title",
    ...overrides,
  };
}

function syncedDocument(overrides: LegacyTaskDocument = {}) {
  return {
    _id: new ObjectId(),
    action_type: "Google title",
    duration: 45,
    event_id: "event-1",
    is_active: true,
    is_deleted: false,
    priority_index: "10-00000128",
    task_date: new Date("2026-09-08T00:00:00.000Z"),
    task_time: new Date("2026-09-08T18:00:00.000Z"),
    task_type: "A",
    user_id: 43,
    carnival_google: {
      account_id: "account-1",
      all_day: false,
      calendar_id: "appointments@example.test",
      end: "2026-09-08T18:45:00.000Z",
      event_id: "event-1",
      event_updated_at: "2026-09-06T18:00:00Z",
      semantic_role: "appointment",
      start: "2026-09-08T18:00:00.000Z",
      status: "confirmed",
      time_zone: "America/Los_Angeles",
    },
    ...overrides,
  };
}

function collectionWith(documents: LegacyTaskDocument[]) {
  const bulkWrite = vi.fn().mockResolvedValue({ upsertedCount: 0 });
  const find = vi.fn(() => ({ toArray: async () => documents }));
  return {
    bulkWrite,
    collection: { bulkWrite, find } as unknown as Collection<LegacyTaskDocument>,
    find,
  };
}

describe("Mongo Appointment synchronization", () => {
  it("uses account + calendar + event with the fixed legacy user as identity", () => {
    expect(appointmentMongoIdentityFilter(identity, "event-1")).toEqual({
      "carnival_google.account_id": "account-1",
      "carnival_google.calendar_id": "appointments@example.test",
      "carnival_google.event_id": "event-1",
      user_id: 43,
    });
  });

  it("batches the read and inserts a new Appointment without unrelated fields", async () => {
    const mock = collectionWith([]);
    mock.bulkWrite.mockResolvedValue({ upsertedCount: 1 });

    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [event()],
      ...syncArguments,
    });

    expect(mock.find).toHaveBeenCalledTimes(1);
    expect(mock.bulkWrite).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      failed: [], imported: 1, mongoReads: 1, mongoWriteBatches: 1, mongoWrites: 1,
    });
    const operation = mock.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.update.$setOnInsert).toMatchObject({
      contact_id: "",
      event_id: "event-1",
      is_active: true,
      is_deleted: false,
      task_type: "A",
      user_id: 43,
    });
    expect(operation.update.$setOnInsert).not.toHaveProperty("long_id");
  });

  it("writes only changed Google-owned fields and preserves unrelated fields", async () => {
    const existing = syncedDocument({ long_id: "keep", note: "keep" });
    const mock = collectionWith([existing]);

    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [event({ durationMinutes: 90, title: "Edited in Google" })],
      ...syncArguments,
    });

    expect(result.updated).toBe(1);
    const operation = mock.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.filter).toEqual({ _id: existing._id, user_id: 43 });
    expect(operation.update.$set).toMatchObject({
      action_type: "Edited in Google",
      duration: 90,
    });
    expect(operation.update.$set).not.toHaveProperty("long_id");
    expect(operation.update.$set).not.toHaveProperty("note");
    expect(operation.update.$set).not.toHaveProperty("task_date");
  });

  it("performs no write for an unchanged repeated sync", async () => {
    const mock = collectionWith([syncedDocument()]);

    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [event()],
      ...syncArguments,
    });

    expect(mock.find).toHaveBeenCalledTimes(1);
    expect(mock.bulkWrite).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      imported: 0,
      mongoReads: 1,
      mongoWriteBatches: 0,
      mongoWrites: 0,
      unchanged: 1,
      updated: 0,
    });
  });

  it("marks cancelled and missing synced Appointments inactive in one write batch", async () => {
    const cancelled = syncedDocument();
    const missing = syncedDocument({
      _id: new ObjectId(),
      event_id: "event-2",
      carnival_google: {
        ...(syncedDocument().carnival_google as Record<string, unknown>),
        event_id: "event-2",
      },
    });
    const mock = collectionWith([cancelled, missing]);

    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [event({ status: "cancelled", start: "", end: "" })],
      ...syncArguments,
    });

    expect(result).toMatchObject({ inactivated: 2, mongoWriteBatches: 1, mongoWrites: 2 });
    const operations = mock.bulkWrite.mock.calls[0][0];
    expect(operations[0].updateOne.update.$set).toMatchObject({ is_active: false });
    expect(operations[0].updateOne.update.$set).not.toHaveProperty("is_deleted");
    expect(operations[1].updateOne.update.$set).toMatchObject({
      "carnival_google.status": "missing",
      is_active: false,
    });
  });

  it("uses each recurring instance event ID as stable identity", async () => {
    const first = syncedDocument();
    const second = syncedDocument({
      _id: new ObjectId(),
      event_id: "series_20260915T180000Z",
      task_date: new Date("2026-09-15T00:00:00.000Z"),
      task_time: new Date("2026-09-15T18:00:00.000Z"),
      carnival_google: {
        ...(syncedDocument().carnival_google as Record<string, unknown>),
        end: "2026-09-15T18:45:00.000Z",
        event_id: "series_20260915T180000Z",
        start: "2026-09-15T18:00:00.000Z",
      },
    });
    const mock = collectionWith([first, second]);

    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [
        event(),
        event({
          eventId: "series_20260915T180000Z",
          scheduledDate: "2026-09-15",
          start: "2026-09-15T18:00:00.000Z",
          end: "2026-09-15T18:45:00.000Z",
          taskTime: new Date("2026-09-15T18:00:00.000Z"),
        }),
      ],
      ...syncArguments,
    });

    expect(result).toMatchObject({ imported: 0, unchanged: 2, updated: 0 });
    expect(mock.bulkWrite).not.toHaveBeenCalled();
  });

  it("deduplicates against one legacy event_id and rejects ambiguous legacy IDs", async () => {
    const legacy = syncedDocument({ carnival_google: undefined });
    const duplicate = syncedDocument({ _id: new ObjectId(), carnival_google: undefined });
    const safeMock = collectionWith([legacy]);
    const ambiguousMock = collectionWith([legacy, duplicate]);

    const safe = await synchronizeMongoAppointments({
      collection: safeMock.collection,
      events: [event()],
      ...syncArguments,
    });
    const ambiguous = await synchronizeMongoAppointments({
      collection: ambiguousMock.collection,
      events: [event()],
      ...syncArguments,
    });

    expect(safe).toMatchObject({ imported: 0, updated: 1 });
    expect(ambiguous.failed).toEqual([{
      eventId: "event-1",
      reason: "Multiple legacy Appointments share this Google event ID.",
    }]);
    expect(ambiguousMock.bulkWrite).not.toHaveBeenCalled();
  });

  it("does not reactivate an Appointment made inactive outside Google cancellation", async () => {
    const mock = collectionWith([syncedDocument({ is_active: false })]);

    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [event()],
      ...syncArguments,
    });

    expect(result.unchanged).toBe(1);
    expect(mock.bulkWrite).not.toHaveBeenCalled();
  });

  it("isolates malformed events", async () => {
    const mock = collectionWith([]);
    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [null],
      ...syncArguments,
    });

    expect(result.failed).toEqual([{ eventId: null, reason: "Malformed Google event." }]);
    expect(mock.bulkWrite).not.toHaveBeenCalled();
  });
});
