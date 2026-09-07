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

function emptyLegacyCursor() {
  return { limit: () => ({ toArray: async () => [] }) };
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

  it("imports a new Appointment with A rank and no Google writes or invented long_id", async () => {
    const findOne = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0, upsertedCount: 1 });
    const collection = {
      find: vi.fn(() => emptyLegacyCursor()),
      findOne,
      updateOne,
    } as unknown as Collection<LegacyTaskDocument>;

    const result = await synchronizeMongoAppointments({ collection, events: [event()], identity });

    expect(result).toMatchObject({ failed: [], imported: 1 });
    const operation = updateOne.mock.calls[0][1];
    expect(operation.$setOnInsert).toMatchObject({
      contact_id: "",
      event_id: "event-1",
      is_active: true,
      is_deleted: false,
      task_type: "A",
      user_id: 43,
    });
    expect(operation.$setOnInsert).not.toHaveProperty("long_id");
  });

  it("updates a unique migrated legacy Appointment and preserves unrelated fields", async () => {
    const legacyId = new ObjectId();
    const findOne = vi.fn().mockResolvedValueOnce(null);
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const collection = {
      find: vi.fn(() => ({
        limit: () => ({
          toArray: async () => [{ _id: legacyId, event_id: "event-1", long_id: "keep", note: "keep" }],
        }),
      })),
      findOne,
      updateOne,
    } as unknown as Collection<LegacyTaskDocument>;

    const result = await synchronizeMongoAppointments({
      collection,
      events: [event({
        durationMinutes: 90,
        end: "2026-09-09T19:30:00.000Z",
        scheduledDate: "2026-09-09",
        start: "2026-09-09T18:00:00.000Z",
        taskTime: new Date("2026-09-09T18:00:00.000Z"),
        title: "Edited in Google",
      })],
      identity,
    });

    expect(result.updated).toBe(1);
    expect(updateOne.mock.calls[0][0]).toEqual({ _id: legacyId, user_id: 43 });
    expect(updateOne.mock.calls[0][1].$set).toMatchObject({
      action_type: "Edited in Google",
      duration: 90,
      task_date: new Date("2026-09-09T00:00:00.000Z"),
      task_time: new Date("2026-09-09T18:00:00.000Z"),
      task_type: "A",
    });
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("long_id");
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("note");
  });

  it("is idempotent and never inserts when the exact identity already exists", async () => {
    const existingId = new ObjectId();
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });
    const collection = {
      findOne: vi.fn().mockResolvedValue({ _id: existingId }),
      updateOne,
    } as unknown as Collection<LegacyTaskDocument>;

    const result = await synchronizeMongoAppointments({ collection, events: [event()], identity });

    expect(result).toMatchObject({ imported: 0, unchanged: 1 });
    expect(updateOne.mock.calls[0][2]).toBeUndefined();
    expect(updateOne.mock.calls[0][1]).not.toHaveProperty("$setOnInsert");
  });

  it("marks a cancelled Appointment inactive without physical deletion", async () => {
    const existingId = new ObjectId();
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const collection = {
      findOne: vi.fn().mockResolvedValue({ _id: existingId }),
      updateOne,
    } as unknown as Collection<LegacyTaskDocument>;

    const result = await synchronizeMongoAppointments({
      collection,
      events: [event({ status: "cancelled", start: "", end: "" })],
      identity,
    });

    expect(result.inactivated).toBe(1);
    expect(updateOne.mock.calls[0][1].$set).toMatchObject({ is_active: false });
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("is_deleted");
    expect(updateOne.mock.calls[0]).toHaveLength(2);
  });

  it("isolates malformed and ambiguous legacy events", async () => {
    const collection = {
      find: vi.fn(() => ({
        limit: () => ({ toArray: async () => [{ _id: new ObjectId() }, { _id: new ObjectId() }] }),
      })),
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn(),
    } as unknown as Collection<LegacyTaskDocument>;

    const result = await synchronizeMongoAppointments({
      collection,
      events: [null, event()],
      identity,
    });

    expect(result.failed).toEqual([
      { eventId: null, reason: "Malformed Google event." },
      { eventId: "event-1", reason: "Multiple legacy Appointments share this Google event ID." },
    ]);
  });
});
