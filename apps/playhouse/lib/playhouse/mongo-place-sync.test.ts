import { ObjectId, type Collection } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import type { MappedGoogleAppointment } from "../google/appointment-events";
import {
  isPlaceBlocked,
  synchronizeMongoAppointments,
} from "./mongo-appointment-sync";
import type { LegacyTaskDocument } from "./mongo-play-mapping";

const identity = {
  googleAccountId: "account-1",
  googleCalendarId: "places@example.test",
  semanticRole: "place" as const,
};
const syncWindow = {
  endDateExclusive: "2026-12-14",
  identity,
  startDate: "2026-09-15",
};

function place(overrides: Partial<MappedGoogleAppointment> = {}): MappedGoogleAppointment {
  return {
    allDay: true,
    blockedDates: ["2026-09-15", "2026-09-16"],
    durationMinutes: 0,
    end: "2026-09-17",
    eventId: "place-1",
    googleUpdatedAt: "2026-09-14T20:00:00Z",
    scheduledDate: "2026-09-15",
    start: "2026-09-15",
    status: "confirmed",
    taskTime: "",
    timeZone: "America/Los_Angeles",
    title: "Japan Cruise",
    ...overrides,
  };
}

function syncedPlace(overrides: LegacyTaskDocument = {}): LegacyTaskDocument {
  return {
    _id: new ObjectId(),
    action_type: "Japan Cruise",
    carnival_google: {
      account_id: "account-1",
      all_day: true,
      blocked_dates: ["2026-09-15", "2026-09-16"],
      calendar_id: "places@example.test",
      end: "2026-09-17",
      event_id: "place-1",
      event_updated_at: "2026-09-14T20:00:00Z",
      semantic_role: "place",
      start: "2026-09-15",
      status: "confirmed",
      time_zone: "America/Los_Angeles",
    },
    duration: 0,
    event_id: "place-1",
    is_active: true,
    is_deleted: false,
    note: "preserve",
    priority_index: "10-00000128",
    task_date: new Date("2026-09-15T00:00:00.000Z"),
    task_time: "",
    time_task: false,
    user_id: 43,
    ...overrides,
  };
}

function collectionWith(documents: LegacyTaskDocument[], upsertedCount = 0) {
  const bulkWrite = vi.fn().mockResolvedValue({ upsertedCount });
  const countDocuments = vi.fn().mockResolvedValue(1);
  const find = vi.fn(() => ({ toArray: async () => documents }));
  return {
    bulkWrite,
    collection: { bulkWrite, countDocuments, find } as unknown as Collection<LegacyTaskDocument>,
    countDocuments,
    find,
  };
}

describe("Mongo AT_Places synchronization", () => {
  it("imports one non-Play context record with all blocked dates", async () => {
    const mock = collectionWith([], 1);
    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [place()],
      ...syncWindow,
    });

    expect(result).toMatchObject({ imported: 1, mongoReads: 1, mongoWriteBatches: 1 });
    const operation = mock.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.update.$set).toMatchObject({
      "carnival_google.blocked_dates": ["2026-09-15", "2026-09-16"],
      "carnival_google.semantic_role": "place",
    });
    expect(operation.update.$setOnInsert).not.toHaveProperty("task_type");
    expect(operation.update.$setOnInsert).toMatchObject({
      is_active: true,
      is_deleted: false,
      task_time: "",
      time_task: false,
      user_id: 43,
    });
  });

  it("does not duplicate or rewrite an unchanged Place", async () => {
    const mock = collectionWith([syncedPlace()]);
    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [place()],
      ...syncWindow,
    });

    expect(result).toMatchObject({ imported: 0, unchanged: 1, updated: 0 });
    expect(mock.bulkWrite).not.toHaveBeenCalled();
  });

  it("replaces title and blocked dates without overwriting unrelated fields", async () => {
    const existing = syncedPlace();
    const mock = collectionWith([existing]);
    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [place({
        blockedDates: ["2026-09-16", "2026-09-17", "2026-09-18"],
        end: "2026-09-19",
        scheduledDate: "2026-09-16",
        start: "2026-09-16",
        title: "Japan Cruise updated",
      })],
      ...syncWindow,
    });

    expect(result.updated).toBe(1);
    const operation = mock.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.filter).toEqual({ _id: existing._id, user_id: 43 });
    expect(operation.update.$set).toMatchObject({
      "carnival_google.blocked_dates": ["2026-09-16", "2026-09-17", "2026-09-18"],
      action_type: "Japan Cruise updated",
      task_date: new Date("2026-09-16T00:00:00.000Z"),
    });
    expect(operation.update.$set).not.toHaveProperty("note");
  });

  it("inactivates cancelled and missing Places without deleting them", async () => {
    const cancelled = syncedPlace();
    const missing = syncedPlace({
      _id: new ObjectId(),
      carnival_google: {
        ...(syncedPlace().carnival_google as Record<string, unknown>),
        event_id: "place-2",
      },
      event_id: "place-2",
    });
    const mock = collectionWith([cancelled, missing]);
    const result = await synchronizeMongoAppointments({
      collection: mock.collection,
      events: [place({ blockedDates: [], end: "", scheduledDate: "", start: "", status: "cancelled" })],
      ...syncWindow,
    });

    expect(result).toMatchObject({ inactivated: 2, mongoWrites: 2 });
    for (const operation of mock.bulkWrite.mock.calls[0][0]) {
      expect(operation.updateOne.update.$set).toMatchObject({ is_active: false });
      expect(operation.updateOne.update.$set).not.toHaveProperty("is_deleted");
    }
  });

  it("exposes an exact active whole-day availability query", async () => {
    const mock = collectionWith([]);
    await expect(isPlaceBlocked(mock.collection, "2026-09-15")).resolves.toBe(true);
    expect(mock.countDocuments).toHaveBeenCalledWith({
      "carnival_google.blocked_dates": "2026-09-15",
      "carnival_google.semantic_role": "place",
      is_active: true,
      is_deleted: { $ne: true },
      user_id: 43,
    }, { limit: 1 });
  });
});
