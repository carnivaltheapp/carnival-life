import { ObjectId, type Collection } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import type { BasketSummary } from "../../domain/play";
import type { PlayInput } from "../../domain/play-input";
import {
  MONGO_CARNIVAL_USER_ID,
  type LegacyTaskDocument,
} from "./mongo-play-mapping";
import { MongoPlayRepository } from "./mongo-play-repository";

const baskets: BasketSummary[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Backlog", slug: "backlog", sortOrder: 10 },
];

function repository(collection: Partial<Collection<LegacyTaskDocument>>, ownerUserId = MONGO_CARNIVAL_USER_ID) {
  return new MongoPlayRepository({
    baskets,
    collection: collection as Collection<LegacyTaskDocument>,
    ownerUserId,
    supabase: {} as never,
  });
}

function playInput(overrides: Partial<PlayInput> = {}): PlayInput {
  return {
    branch: "Branch",
    durationMinutes: 30,
    note: "Note",
    place: "office",
    placement: { kind: "calendar", scheduledDate: "2026-08-27" },
    playType: "normal",
    playerContactId: null,
    pushRule: "everyday",
    title: "Edited title",
    url: "https://example.test",
    ...overrides,
  };
}

describe("MongoPlayRepository mutations", () => {
  it("rejects an authenticated Carnival user outside the fixed mapping", () => {
    expect(() => repository({}, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toThrow(
      "not mapped to the legacy Play store",
    );
  });

  it.each([
    ["done", { is_active: false }],
    ["trash", { is_active: false, is_deleted: true }],
  ] as const)("applies scoped, non-destructive %s semantics", async (status, expectedSet) => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const id = new ObjectId();
    const saved = await repository({ updateOne: updateOne as never }).setStatus(
      id.toHexString(),
      status,
    );

    expect(saved).toBe(true);
    expect(updateOne).toHaveBeenCalledOnce();
    expect(updateOne.mock.calls[0][0]).toEqual({
      _id: id,
      is_active: true,
      is_deleted: false,
      user_id: 43,
    });
    expect(updateOne.mock.calls[0][1].$set).toMatchObject(expectedSet);
    if (status === "done") {
      expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("is_deleted");
    }
  });

  it("returns false without querying for a malformed or cross-store identifier", async () => {
    const updateOne = vi.fn();
    expect(await repository({ updateOne: updateOne as never }).setStatus("bad", "done")).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("edits with a targeted $set, exact identity/user scope, and preserves U task_type", async () => {
    const id = new ObjectId();
    const findOne = vi.fn().mockResolvedValue({ _id: id, task_type: "U", user_id: 43 });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const saved = await repository({
      findOne: findOne as never,
      updateOne: updateOne as never,
    }).save({
      input: playInput(),
      playId: id.toHexString(),
      playerResourceName: "people/changed",
    });

    expect(saved).toBe(true);
    expect(updateOne.mock.calls[0][0]).toEqual({
      _id: id,
      is_active: true,
      is_deleted: false,
      user_id: 43,
    });
    expect(updateOne.mock.calls[0][1]).toEqual({
      $set: expect.objectContaining({
        action_type: "Edited title",
        contact_id: "people/changed",
        duration: 30,
        note: "Note",
        place: "office",
        push_type: "Everyday",
        task_date: new Date("2026-08-27T00:00:00.000Z"),
        url: "https://example.test",
      }),
    });
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("task_type");
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("event_id");
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("thread_id");
  });

  it("clears Player using the established blank representation", async () => {
    const id = new ObjectId();
    const findOne = vi.fn().mockResolvedValue({ _id: id, task_type: "H", user_id: 43 });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await repository({ findOne: findOne as never, updateOne: updateOne as never }).save({
      input: playInput(),
      playId: id.toHexString(),
      playerResourceName: null,
    });
    expect(updateOne.mock.calls[0][1].$set.contact_id).toBe("");
  });

  it("lists every active type and includes the exact date/user filters", async () => {
    const tasks = ["H", "S", "U", "P", "A", "", null, "unknown"].map((taskType) => ({
      _id: new ObjectId(),
      action_type: `Type ${String(taskType)}`,
      is_active: true,
      is_deleted: false,
      task_date: new Date("2026-08-27T00:00:00.000Z"),
      task_type: taskType,
      user_id: 43,
    }));
    const toArray = vi.fn().mockResolvedValue(tasks);
    const sort = vi.fn().mockReturnValue({ toArray });
    const find = vi.fn().mockReturnValue({ sort });
    const result = await repository({ find: find as never }).list({
      endDate: "2026-08-27",
      key: "today",
      kind: "calendar",
      label: "Today",
      startDate: "2026-08-27",
    });

    expect(result.plays).toHaveLength(8);
    expect(result.plays.map((play) => play.playType)).toEqual([
      "normal", "reminder", "normal", "normal", "normal", "normal", "normal", "normal",
    ]);
    expect(find.mock.calls[0][0]).toMatchObject({
      is_active: true,
      is_deleted: false,
      user_id: 43,
    });
    expect(find.mock.calls[0][0]).not.toHaveProperty("task_type");
  });

  it("queries a Basket by its documented sentinel without loading other Plays", async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const find = vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({ toArray }),
    });
    await repository({ find: find as never }).list({
      basket: baskets[0],
      kind: "basket",
      label: "Backlog",
    });
    expect(find.mock.calls[0][0]).toMatchObject({
      task_date: {
        $gte: new Date("2400-01-11T00:00:00.000Z"),
        $lt: new Date("2400-01-12T00:00:00.000Z"),
      },
      user_id: 43,
    });
  });

  it("lists all active calendar and Basket Plays in date, type, priority order", async () => {
    const tasks = [
      {
        _id: new ObjectId(),
        action_type: "Earlier reminder",
        priority_index: "10-00000128",
        task_date: new Date("2026-08-27T00:00:00.000Z"),
        task_type: "S",
      },
      {
        _id: new ObjectId(),
        action_type: "Earlier normal first",
        priority_index: "10-00000228",
        task_date: new Date("2026-08-27T00:00:00.000Z"),
        task_type: "H",
      },
      {
        _id: new ObjectId(),
        action_type: "Earlier normal second",
        priority_index: "10-00000328",
        task_date: new Date("2026-08-27T00:00:00.000Z"),
        task_type: "U",
      },
      {
        _id: new ObjectId(),
        action_type: "Backlog normal",
        priority_index: "10-00000128",
        task_date: new Date("2400-01-11T00:00:00.000Z"),
        task_type: "P",
      },
    ];
    const toArray = vi.fn().mockResolvedValue(tasks);
    const sort = vi.fn().mockReturnValue({ toArray });
    const find = vi.fn().mockReturnValue({ sort });

    const result = await repository({ find: find as never }).list({
      defaultDate: "2026-08-27",
      key: "all",
      kind: "all",
      label: "All Plays",
    });

    expect(find).toHaveBeenCalledWith({
      is_active: true,
      is_deleted: false,
      user_id: 43,
    });
    expect(sort).toHaveBeenCalledWith({
      task_date: 1,
      priority_index: 1,
      created_date: 1,
      _id: 1,
    });
    expect(result.plays.map((play) => play.title)).toEqual([
      "Earlier normal first",
      "Earlier normal second",
      "Earlier reminder",
      "Backlog normal",
    ]);
    expect(result.plays.at(-1)).toMatchObject({
      basketId: baskets[0].id,
      scheduledDate: null,
    });
  });
});
