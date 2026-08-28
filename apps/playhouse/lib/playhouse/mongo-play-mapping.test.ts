import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import type { BasketSummary } from "../../domain/play";
import type { PlayInput } from "../../domain/play-input";
import {
  legacyTaskTypeForSave,
  mapMongoPlay,
  mongoActiveFilter,
  mongoBasketFilter,
  mongoCreateDocument,
  mongoDateFilter,
  mongoEditableSet,
  mongoMutationFilter,
  mongoPlayType,
  MONGO_LEGACY_USER_ID,
  nextLegacyPriorityIndex,
} from "./mongo-play-mapping";

const baskets: BasketSummary[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Backlog", slug: "backlog", sortOrder: 10 },
  { id: "22222222-2222-4222-8222-222222222222", name: "Soon", slug: "soon", sortOrder: 20 },
];

function input(overrides: Partial<PlayInput> = {}): PlayInput {
  return {
    branch: "Work",
    durationMinutes: 30,
    note: "Note",
    place: "office",
    placement: { kind: "calendar", scheduledDate: "2026-08-27" },
    playType: "normal",
    playerContactId: null,
    pushRule: "weekdays",
    title: "Mapped Play",
    url: "https://example.test",
    ...overrides,
  };
}

describe("Mongo Play mapping", () => {
  it.each([
    ["S", "reminder"],
    ["H", "normal"],
    ["U", "normal"],
    ["P", "normal"],
    ["A", "normal"],
    ["", "normal"],
    [null, "normal"],
    ["future-value", "normal"],
  ])("maps task_type %s to %s", (taskType, expected) => {
    expect(mongoPlayType(taskType)).toBe(expected);
  });

  it("preserves a non-S task type unless the user explicitly changes type", () => {
    expect(legacyTaskTypeForSave("U", "normal")).toBeUndefined();
    expect(legacyTaskTypeForSave("P", "normal")).toBeUndefined();
    expect(legacyTaskTypeForSave("S", "reminder")).toBeUndefined();
    expect(legacyTaskTypeForSave("S", "normal")).toBe("H");
    expect(legacyTaskTypeForSave("U", "reminder")).toBe("S");
  });

  it("always scopes active reads to the legacy user without filtering task_type", () => {
    expect(mongoActiveFilter()).toEqual({
      is_active: true,
      is_deleted: false,
      user_id: MONGO_LEGACY_USER_ID,
    });
    expect(mongoActiveFilter()).not.toHaveProperty("task_type");
  });

  it("builds efficient date and documented Basket filters", () => {
    expect(mongoDateFilter("2026-08-27")).toMatchObject({
      is_active: true,
      is_deleted: false,
      user_id: 43,
      task_date: {
        $gte: new Date("2026-08-27T00:00:00.000Z"),
        $lt: new Date("2026-08-28T00:00:00.000Z"),
      },
    });
    expect(mongoBasketFilter("backlog")).toMatchObject({
      task_date: {
        $gte: new Date("2400-01-11T00:00:00.000Z"),
        $lt: new Date("2400-01-12T00:00:00.000Z"),
      },
      user_id: 43,
    });
  });

  it("requires exact ObjectId and user scope for mutations", () => {
    const id = new ObjectId();
    expect(mongoMutationFilter(id.toHexString())).toEqual({ _id: id, user_id: 43 });
    expect(() => mongoMutationFilter("not-an-id")).toThrow("Invalid Mongo Play identifier");
  });

  it("maps all displayed fields and the contact reference round trip", () => {
    const task = {
      _id: new ObjectId(),
      action_type: "Legacy title",
      branch: "Branch",
      contact_id: "people/legacy-player",
      duration: 45,
      is_active: true,
      is_deleted: false,
      note: "Legacy note",
      place: "outside",
      push_type: "Weekend",
      regarding: "email",
      task_date: new Date("2400-01-11T00:00:00.000Z"),
      task_type: "U",
      thread_id: "gmail-thread-id",
      url: "https://example.test/path",
      user_id: 43,
    };
    expect(mapMongoPlay(task, baskets, {
      displayName: "Player Example",
      id: "33333333-3333-4333-8333-333333333333",
    })).toMatchObject({
      basketId: baskets[0].id,
      branch: "Branch",
      durationMinutes: 45,
      gmailThreadId: "gmail-thread-id",
      note: "Legacy note",
      place: "outside",
      playerContactId: "33333333-3333-4333-8333-333333333333",
      playerDisplayName: "Player Example",
      playType: "normal",
      pushRule: "weekends",
      scheduledDate: null,
      sourceType: "gmail",
      title: "Legacy title",
      url: "https://example.test/path",
    });
  });

  it("uses targeted editable fields and preserves unrelated legacy fields", () => {
    const values = mongoEditableSet({
      baskets,
      existingTaskType: "P",
      input: input(),
      playerResourceName: "people/selected",
    });
    expect(values).toMatchObject({
      action_type: "Mapped Play",
      branch: "Work",
      contact_id: "people/selected",
      duration: 30,
      note: "Note",
      place: "office",
      push_type: "Weekday",
      task_date: new Date("2026-08-27T00:00:00.000Z"),
      url: "https://example.test",
    });
    expect(values).not.toHaveProperty("task_type");
    for (const field of ["event_id", "long_id", "thread_id", "message_id", "last_id", "first", "last", "phone", "email"]) {
      expect(values).not.toHaveProperty(field);
    }
  });

  it("does not erase the legacy duration during an unrelated Reminder edit", () => {
    const values = mongoEditableSet({
      baskets,
      existingTaskType: "S",
      input: input({ durationMinutes: null, playType: "reminder" }),
      playerResourceName: null,
    });
    expect(values).not.toHaveProperty("duration");
    expect(values).not.toHaveProperty("task_type");
  });

  it.each([
    [{ kind: "calendar", scheduledDate: "2026-08-28" } as const, "2026-08-28"],
    [{ basketId: baskets[0].id, kind: "basket" } as const, "2400-01-11"],
    [{ basketId: baskets[1].id, kind: "basket" } as const, "2400-01-01"],
  ])("maps moves to date or Basket sentinel", (placement, expectedDay) => {
    const values = mongoEditableSet({
      baskets,
      existingTaskType: "H",
      input: input({ placement }),
      playerResourceName: null,
    });
    expect((values.task_date as Date).toISOString().slice(0, 10)).toBe(expectedDay);
  });

  it("creates a legacy-compatible scoped document with current defaults", () => {
    const document = mongoCreateDocument({
      baskets,
      input: input(),
      playerResourceName: null,
      priorityIndex: "10-00000228",
      now: new Date("2026-08-27T12:00:00.000Z"),
    });
    expect(document).toMatchObject({
      action_type: "Mapped Play",
      contact_id: "",
      is_active: true,
      is_deleted: false,
      place: "office",
      priority_index: "10-00000228",
      task_type: "H",
      user_id: 43,
    });
  });

  it("continues the observed legacy priority format", () => {
    expect(nextLegacyPriorityIndex("10-00000128")).toBe("10-00000228");
    expect(nextLegacyPriorityIndex(null)).toBe("10-00000128");
  });
});
