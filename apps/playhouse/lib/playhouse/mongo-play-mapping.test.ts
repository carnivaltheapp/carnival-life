import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import type { BasketSummary } from "../../domain/play";
import type { PlayInput } from "../../domain/play-input";
import {
  expandMongoPlaceRows,
  legacyTaskTypeForSave,
  mapMongoPlay,
  mongoActiveFilter,
  mongoAllScheduledFilter,
  mongoBasketFilter,
  mongoCreateDocument,
  mongoDateFilter,
  mongoEditableSet,
  mongoLifecycleFilter,
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

  it("scopes Play reads to the legacy user and excludes Place context records", () => {
    expect(mongoActiveFilter()).toEqual({
      "carnival_google.semantic_role": { $ne: "place" },
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
      $or: [
        {
          "carnival_google.semantic_role": { $ne: "place" },
          task_date: {
            $gte: new Date("2026-08-27T00:00:00.000Z"),
            $lt: new Date("2026-08-28T00:00:00.000Z"),
          },
        },
        {
          "carnival_google.blocked_dates": {
            $elemMatch: { $gte: "2026-08-27", $lte: "2026-08-27" },
          },
          "carnival_google.semantic_role": "place",
        },
      ],
    });
    expect(mongoBasketFilter("backlog")).toMatchObject({
      task_date: {
        $gte: new Date("2400-01-11T00:00:00.000Z"),
        $lt: new Date("2400-01-12T00:00:00.000Z"),
      },
      user_id: 43,
    });
  });

  it("applies lifecycle independently over Date, Basket, 7-day, and Today-forward scopes", () => {
    expect(mongoLifecycleFilter("done")).toMatchObject({
      is_active: false,
      is_deleted: false,
      user_id: 43,
    });
    expect(mongoDateFilter("2026-09-25", "2026-09-25", "trash")).toMatchObject({
      is_active: false,
      is_deleted: true,
      $or: [expect.objectContaining({
        task_date: {
          $gte: new Date("2026-09-25T00:00:00.000Z"),
          $lt: new Date("2026-09-26T00:00:00.000Z"),
        },
      }), expect.anything()],
    });
    expect(mongoDateFilter("2026-09-23", "2026-09-29", "done")).toMatchObject({
      is_active: false,
      is_deleted: false,
      $or: [expect.objectContaining({
        task_date: {
          $gte: new Date("2026-09-23T00:00:00.000Z"),
          $lt: new Date("2026-09-30T00:00:00.000Z"),
        },
      }), expect.anything()],
    });
    expect(mongoBasketFilter("soon", "trash")).toMatchObject({
      is_active: false,
      is_deleted: true,
      user_id: 43,
    });
    expect(mongoAllScheduledFilter("2026-09-23", "done")).toMatchObject({
      is_active: false,
      is_deleted: false,
      task_date: {
        $gte: new Date("2026-09-23T00:00:00.000Z"),
        $lt: new Date("2200-01-01T00:00:00.000Z"),
      },
    });
  });

  it("maps one Place source event to every applicable visible date without a Play rank", () => {
    const task = {
      _id: new ObjectId(),
      action_type: "Japan Cruise",
      carnival_google: {
        blocked_dates: ["2026-09-26", "2026-09-27", "2026-09-28"],
        semantic_role: "place",
      },
      is_active: true,
      is_deleted: false,
      task_date: new Date("2026-09-26T00:00:00.000Z"),
      user_id: 43,
    };
    const mapped = mapMongoPlay(task, baskets);
    expect(mapped).toMatchObject({
      contextType: "place",
      legacyTaskType: null,
      title: "Japan Cruise",
    });
    expect(expandMongoPlaceRows(mapped, task, "2026-09-26", "2026-09-28").map((row) => ({
      id: row.id,
      scheduledDate: row.scheduledDate,
    }))).toEqual([
      { id: `${task._id}:place:2026-09-26`, scheduledDate: "2026-09-26" },
      { id: `${task._id}:place:2026-09-27`, scheduledDate: "2026-09-27" },
      { id: `${task._id}:place:2026-09-28`, scheduledDate: "2026-09-28" },
    ]);
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
      carnival_google: {
        gmail_api_thread_id: "1a0ad6003af12a6b",
        gmail_attachment: {
          account_index: 2,
          api_thread_id: "1a0ad6003af12a6b",
          thread_ref: "FMfcgzQZSexact",
        },
      },
      carnival_incoming: {
        gmail_latest_url: "https://mail.google.com/mail/u/2/#all/api-thread",
        gmail_unhandled_count: 2,
        priority: true,
      },
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
      gmailAccountIndex: 2,
      gmailApiThreadId: "1a0ad6003af12a6b",
      gmailThreadId: "gmail-thread-id",
      gmailWebThreadRef: "FMfcgzQZSexact",
      incomingGmailCount: 2,
      incomingGmailUrl: "https://mail.google.com/mail/u/2/#all/api-thread",
      incomingPriority: true,
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

  it("does not use a legacy hexadecimal API thread ID for browser synchronization", () => {
    const task = {
      _id: new ObjectId(),
      action_type: "Legacy Gmail Play",
      is_active: true,
      is_deleted: false,
      regarding: "email",
      task_date: new Date("2026-09-17T00:00:00.000Z"),
      task_type: "H",
      thread_id: "1a0ad6003af12a6b",
      user_id: 43,
    };
    expect(mapMongoPlay(task, baskets)).toMatchObject({
      gmailApiThreadId: "1a0ad6003af12a6b",
      gmailThreadId: "1a0ad6003af12a6b",
      gmailWebThreadRef: null,
    });
  });

  it("maps canonical multi-Player references while preserving group identity", () => {
    const task = {
      _id: new ObjectId(),
      action_type: "Group planning",
      carnival_players: [
        {
          contact_reference_id: "33333333-3333-4333-8333-333333333333",
          display_name: "David Example",
          kind: "contact",
          resource_name: "people/david",
        },
        {
          display_name: "Family",
          kind: "group",
          member_count: 2,
          resource_name: "contactGroups/family",
        },
      ],
      contact_id: "people/david",
      is_active: true,
      is_deleted: false,
      task_date: new Date("2026-09-17T00:00:00.000Z"),
      task_type: "H",
      user_id: 43,
    };
    expect(mapMongoPlay(task, baskets, {
      displayName: "David Example",
      id: "33333333-3333-4333-8333-333333333333",
    })).toMatchObject({
      playerDisplayName: "David Example, Family",
      playerEntries: [
        {
          contactId: "33333333-3333-4333-8333-333333333333",
          displayName: "David Example",
          kind: "contact",
          resourceName: "people/david",
        },
        {
          displayName: "Family",
          kind: "group",
          memberCount: 2,
          resourceName: "contactGroups/family",
        },
      ],
    });
  });

  it("uses the canonical Google full display name without changing contact identity", () => {
    const task = {
      _id: new ObjectId(),
      action_type: "Gmail follow-up",
      carnival_players: [{
        contact_reference_id: "stale-reference-id",
        display_name: "Sophi",
        kind: "contact",
        resource_name: "people/sophi",
      }],
      contact_id: "people/sophi",
      is_active: true,
      is_deleted: false,
      task_date: new Date("2026-09-17T00:00:00.000Z"),
      task_type: "H",
      user_id: 43,
    };

    const play = mapMongoPlay(task, baskets, {
      displayName: "Sophi Nabavi",
      id: "33333333-3333-4333-8333-333333333333",
    });

    expect(play.playerDisplayName).toBe("Sophi Nabavi");
    expect(play.playerContactId).toBe("33333333-3333-4333-8333-333333333333");
    expect(play.playerEntries).toEqual([{
      contactId: "33333333-3333-4333-8333-333333333333",
      displayName: "Sophi Nabavi",
      kind: "contact",
      resourceName: "people/sophi",
    }]);
  });

  it("shows a newly assigned contact's canonical first and last name", () => {
    const task = {
      _id: new ObjectId(),
      action_type: "New Gmail Player",
      contact_id: "people/sophi",
      is_active: true,
      is_deleted: false,
      task_date: new Date("2026-09-17T00:00:00.000Z"),
      task_type: "H",
      user_id: 43,
    };

    expect(mapMongoPlay(task, baskets, {
      displayName: "Sophi Nabavi",
      id: "33333333-3333-4333-8333-333333333333",
    })).toMatchObject({
      playerContactId: "33333333-3333-4333-8333-333333333333",
      playerDisplayName: "Sophi Nabavi",
      playerEntries: [{
        displayName: "Sophi Nabavi",
        resourceName: "people/sophi",
      }],
    });
  });

  it("keeps a canonical single-name Google Contact display name", () => {
    const task = {
      _id: new ObjectId(),
      action_type: "Single-name Player",
      carnival_players: [{
        display_name: "Old",
        kind: "contact",
        resource_name: "people/prince",
      }],
      contact_id: "people/prince",
      is_active: true,
      is_deleted: false,
      task_date: new Date("2026-09-17T00:00:00.000Z"),
      task_type: "H",
      user_id: 43,
    };

    expect(mapMongoPlay(task, baskets, {
      displayName: "Prince",
      id: "44444444-4444-4444-8444-444444444444",
    })).toMatchObject({
      playerContactId: "44444444-4444-4444-8444-444444444444",
      playerDisplayName: "Prince",
      playerEntries: [{
        displayName: "Prince",
        resourceName: "people/prince",
      }],
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
