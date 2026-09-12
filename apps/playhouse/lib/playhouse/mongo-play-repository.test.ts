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

function repository(
  collection: Partial<Collection<LegacyTaskDocument>>,
  ownerUserId = MONGO_CARNIVAL_USER_ID,
  supabase: unknown = {},
) {
  return new MongoPlayRepository({
    baskets,
    collection: collection as Collection<LegacyTaskDocument>,
    ownerUserId,
    supabase: supabase as never,
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

  it("attaches one Gmail thread with an exact active user scope and targeted fields", async () => {
    const id = new ObjectId();
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    expect(await repository({ updateOne: updateOne as never }).attachGmail({
      attachment: {
        accountIndex: 2,
        canonicalUrl: "https://mail.google.com/mail/u/2/#all/FMnew",
        threadRef: "FMnew",
      },
      playId: id.toHexString(),
    })).toBe(true);

    expect(updateOne.mock.calls[0][0]).toEqual({
      _id: id,
      "carnival_google.semantic_role": { $ne: "place" },
      is_active: true,
      is_deleted: false,
      task_type: { $ne: "A" },
      user_id: 43,
    });
    expect(updateOne.mock.calls[0][1].$set).toMatchObject({
      "carnival_google.gmail_attachment": {
        account_index: 2,
        canonical_url: "https://mail.google.com/mail/u/2/#all/FMnew",
        thread_ref: "FMnew",
      },
      thread_id: "FMnew",
      updated_date: expect.any(Date),
    });
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("action_type");
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("regarding");
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("url");
  });

  it("assigns only the targeted Play without changing rank or placement", async () => {
    const id = new ObjectId();
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    await expect(repository({ updateOne: updateOne as never }).assignPlayer({
      playId: id.toHexString(),
      playerContactId: "contact-kayla",
      playerResourceName: "people/kayla",
    })).resolves.toBe(true);
    expect(updateOne.mock.calls[0][0]).toEqual({
      _id: id,
      "carnival_google.semantic_role": { $ne: "place" },
      is_active: true,
      is_deleted: false,
      task_type: { $ne: "A" },
      user_id: 43,
    });
    expect(updateOne.mock.calls[0][1].$set).toEqual({
      contact_id: "people/kayla",
      updated_date: expect.any(Date),
    });
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("task_type");
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("task_date");
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

  it("reads Gmail lifecycle identity without loading unrelated Play fields", async () => {
    const id = new ObjectId();
    const findOne = vi.fn().mockResolvedValue({
      _id: id,
      regarding: "email",
      thread_id: " gmail-thread-1 ",
    });

    await expect(repository({ findOne: findOne as never }).getLifecycleIdentity(
      id.toHexString(),
    )).resolves.toEqual({
      gmailThreadId: "gmail-thread-1",
      sourceType: "gmail",
    });
    expect(findOne).toHaveBeenCalledWith({
      _id: id,
      "carnival_google.semantic_role": { $ne: "place" },
      is_active: true,
      is_deleted: false,
      user_id: 43,
    }, {
      projection: { regarding: 1, thread_id: 1 },
    });
  });

  it("bulk-updates only selected non-Appointment Plays with scoped targeted sets", async () => {
    const first = new ObjectId();
    const second = new ObjectId();
    const find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: first, task_type: "H" },
        { _id: second, task_type: "S" },
      ]),
    });
    const bulkWrite = vi.fn().mockResolvedValue({ matchedCount: 2 });

    expect(await repository({
      bulkWrite: bulkWrite as never,
      find: find as never,
    }).bulkUpdate([first.toHexString(), second.toHexString()], {
      kind: "push",
      pushRule: "weekdays",
    })).toBe(true);

    expect(find.mock.calls[0][0]).toMatchObject({
      _id: { $in: [first, second] },
      is_active: true,
      is_deleted: false,
      user_id: 43,
    });
    for (const operation of bulkWrite.mock.calls[0][0]) {
      expect(operation.updateOne.filter).toMatchObject({
        is_active: true,
        is_deleted: false,
        task_type: { $ne: "A" },
        user_id: 43,
      });
      expect(operation.updateOne.update.$set).toMatchObject({
        push_type: "Weekday",
        updated_date: expect.any(Date),
      });
      expect(operation.updateOne.update.$set).not.toHaveProperty("action_type");
    }
  });

  it("flips one Headline to the top Reminder priority with a scoped targeted set", async () => {
    const id = new ObjectId();
    const firstReminder = new ObjectId();
    const findOne = vi.fn().mockResolvedValue({
      _id: id,
      task_date: new Date("2026-09-08T00:00:00.000Z"),
      task_type: "U",
    });
    const toArray = vi.fn().mockResolvedValue([{
      _id: firstReminder,
      priority_index: "10-00000500",
      task_type: "S",
    }]);
    const find = vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({ toArray }),
    });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });

    expect(await repository({
      find: find as never,
      findOne: findOne as never,
      updateOne: updateOne as never,
    }).flipRank({
      playId: id.toHexString(),
      playType: "reminder",
    })).toBe(true);

    expect(updateOne.mock.calls[0][0]).toEqual({
      _id: id,
      "carnival_google.semantic_role": { $ne: "place" },
      is_active: true,
      is_deleted: false,
      task_type: { $nin: ["A", "S"] },
      user_id: 43,
    });
    expect(updateOne.mock.calls[0][1].$set).toMatchObject({
      priority_index: "10-000004FF",
      task_type: "S",
      updated_date: expect.any(Date),
    });
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("task_date");
  });

  it("rejects the entire bulk mutation when an Appointment is present", async () => {
    const appointment = new ObjectId();
    const bulkWrite = vi.fn();
    const find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: appointment, task_type: "A" }]),
    });
    expect(await repository({
      bulkWrite: bulkWrite as never,
      find: find as never,
    }).bulkUpdate([appointment.toHexString()], {
      kind: "push",
      pushRule: "weekdays",
    })).toBe(false);
    expect(bulkWrite).not.toHaveBeenCalled();
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

  it("moves a Headline to a future Reminder with destination priority and no field replacement", async () => {
    const id = new ObjectId();
    const findOne = vi.fn()
      .mockResolvedValueOnce({ _id: id, task_type: "U", user_id: 43 })
      .mockResolvedValueOnce({ priority_index: "10-00000400" });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    expect(await repository({
      findOne: findOne as never,
      updateOne: updateOne as never,
    }).save({
      input: playInput({
        durationMinutes: null,
        placement: { kind: "calendar", scheduledDate: "2026-09-10" },
        playType: "reminder",
      }),
      playId: id.toHexString(),
      playerResourceName: null,
    })).toBe(true);

    expect(findOne.mock.calls[1][0]).toMatchObject({
      _id: { $ne: id },
      is_active: true,
      is_deleted: false,
      task_date: new Date("2026-09-10T00:00:00.000Z"),
      task_type: "S",
      user_id: 43,
    });
    expect(updateOne.mock.calls[0][1]).toEqual({
      $set: expect.objectContaining({
        priority_index: "10-00000500",
        task_date: new Date("2026-09-10T00:00:00.000Z"),
        task_type: "S",
      }),
    });
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("thread_id");
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("event_id");
  });

  it("does not convert an Appointment into a Reminder", async () => {
    const id = new ObjectId();
    const findOne = vi.fn().mockResolvedValue({ _id: id, task_type: "A", user_id: 43 });
    const updateOne = vi.fn();
    expect(await repository({
      findOne: findOne as never,
      updateOne: updateOne as never,
    }).save({
      input: playInput({
        durationMinutes: null,
        placement: { kind: "calendar", scheduledDate: "2026-09-10" },
        playType: "reminder",
      }),
      playId: id.toHexString(),
      playerResourceName: null,
    })).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
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

  it("loads the global search population with one active user-scoped query", async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const sort = vi.fn().mockReturnValue({ toArray });
    const find = vi.fn().mockReturnValue({ sort });
    const result = await repository({ find: find as never }).list();

    expect(result.plays).toEqual([]);
    expect(find).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledWith({
      "carnival_google.semantic_role": { $ne: "place" },
      is_active: true,
      is_deleted: false,
      user_id: 43,
    });
    expect(find.mock.calls[0][0]).not.toHaveProperty("task_type");
    expect(sort).toHaveBeenCalledWith({
      task_date: 1,
      priority_index: 1,
      created_date: 1,
      _id: 1,
    });
  });

  it("does not cache missing contact references while loading search data", async () => {
    const task = {
      _id: new ObjectId(),
      action_type: "Contact Play",
      contact_id: "people/search-only",
      first: "Search",
      is_active: true,
      is_deleted: false,
      last: "Player",
      task_date: new Date("2026-09-06T00:00:00Z"),
      task_type: "H",
      user_id: 43,
    };
    const find = vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([task]) }),
    });
    const inQuery = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ in: inQuery });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    const result = await repository(
      { find: find as never },
      MONGO_CARNIVAL_USER_ID,
      { from },
    ).list();

    expect(result.plays[0]).toMatchObject({
      playerDisplayName: "Search Player",
      title: "Contact Play",
    });
    expect(from).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("contact_references");
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

  it("loads active real dates from browser-local Today in repository priority order", async () => {
    const tasks = [
      {
        _id: new ObjectId(),
        action_type: "Past",
        task_date: new Date("2026-08-26T00:00:00.000Z"),
        task_type: "H",
      },
      {
        _id: new ObjectId(),
        action_type: "Missing date",
        task_type: "H",
      },
      {
        _id: new ObjectId(),
        action_type: "Invalid date",
        task_date: "not-a-date",
        task_type: "H",
      },
      {
        _id: new ObjectId(),
        action_type: "Backlog sentinel",
        task_date: new Date("2400-01-11T00:00:00.000Z"),
        task_type: "H",
      },
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
        action_type: "Future normal",
        priority_index: "10-00000128",
        task_date: new Date("2026-08-28T00:00:00.000Z"),
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
      "carnival_google.semantic_role": { $ne: "place" },
      is_active: true,
      is_deleted: false,
      task_date: {
        $gte: new Date("2026-08-27T00:00:00.000Z"),
        $lt: new Date("2200-01-01T00:00:00.000Z"),
      },
      user_id: 43,
    });
    expect(sort).toHaveBeenCalledWith({
      task_date: 1,
      priority_index: 1,
      created_date: 1,
      _id: 1,
    });
    expect(result.plays.map((play) => play.title)).toEqual([
      "Earlier reminder",
      "Earlier normal first",
      "Earlier normal second",
      "Future normal",
    ]);
    expect(find.mock.calls[0][0]).not.toHaveProperty("task_type");
  });

  it("reorders one Play with a minimal scoped priority update", async () => {
    const [firstId, secondId, movedId] = [new ObjectId(), new ObjectId(), new ObjectId()];
    const date = new Date("2026-09-06T00:00:00.000Z");
    const destination = [
      { _id: firstId, priority_index: "10-00000100", task_date: date, task_type: "H" },
      { _id: secondId, priority_index: "10-00000200", task_date: date, task_type: "H" },
      { _id: movedId, priority_index: "10-00000300", task_date: date, task_type: "H" },
    ];
    const find = vi.fn()
      .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([destination[2]]) })
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(destination) }),
      });
    const bulkWrite = vi.fn().mockResolvedValue({ matchedCount: 1 });

    expect(await repository({
      bulkWrite: bulkWrite as never,
      find: find as never,
    }).reposition({
      beforePlayId: secondId.toHexString(),
      placement: { kind: "calendar", scheduledDate: "2026-09-06" },
      playIds: [movedId.toHexString()],
    })).toBe(true);

    expect(bulkWrite).toHaveBeenCalledOnce();
    const operation = bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.filter).toEqual({
      _id: movedId,
      is_active: true,
      is_deleted: false,
      user_id: 43,
    });
    expect(operation.update.$set).toMatchObject({ priority_index: "10-00000180" });
    expect(operation.update.$set).not.toHaveProperty("task_date");
    expect(operation.update.$set).not.toHaveProperty("task_type");
  });

  it("bulk-moves mixed types to a documented Basket without overwriting unrelated fields", async () => {
    const normalId = new ObjectId();
    const reminderId = new ObjectId();
    const sourceDate = new Date("2026-09-06T00:00:00.000Z");
    const selected = [
      { _id: normalId, priority_index: "10-00000100", task_date: sourceDate, task_type: "U" },
      { _id: reminderId, priority_index: "10-00000200", task_date: sourceDate, task_type: "S" },
    ];
    const find = vi.fn()
      .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue(selected) })
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      });
    const bulkWrite = vi.fn().mockResolvedValue({ matchedCount: 2 });

    expect(await repository({
      bulkWrite: bulkWrite as never,
      find: find as never,
    }).reposition({
      beforePlayId: null,
      placement: { basketId: baskets[0].id, kind: "basket" },
      playIds: [normalId.toHexString(), reminderId.toHexString()],
    })).toBe(true);

    const operations = bulkWrite.mock.calls[0][0].map(
      (operation: { updateOne: { update: { $set: Record<string, unknown> } } }) =>
        operation.updateOne.update.$set,
    );
    expect(operations).toHaveLength(2);
    for (const values of operations) {
      expect(values.task_date).toEqual(new Date("2400-01-11T00:00:00.000Z"));
      expect(values).not.toHaveProperty("task_type");
      expect(values).not.toHaveProperty("contact_id");
      expect(values).not.toHaveProperty("note");
      expect(values).not.toHaveProperty("branch");
      expect(values).not.toHaveProperty("thread_id");
    }
  });

  it("rejects a reposition request containing an Appointment before writing", async () => {
    const appointmentId = new ObjectId();
    const find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: appointmentId, task_type: "A" }]),
    });
    const bulkWrite = vi.fn();

    expect(await repository({
      bulkWrite: bulkWrite as never,
      find: find as never,
    }).reposition({
      beforePlayId: null,
      placement: { kind: "calendar", scheduledDate: "2026-09-07" },
      playIds: [appointmentId.toHexString()],
    })).toBe(false);
    expect(find).toHaveBeenCalledOnce();
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("moves a Play to a real date without changing its legacy type or unrelated fields", async () => {
    const playId = new ObjectId();
    const selected = {
      _id: playId,
      priority_index: "10-00000100",
      task_date: new Date("2400-01-11T00:00:00.000Z"),
      task_type: "P",
    };
    const find = vi.fn()
      .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([selected]) })
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      });
    const bulkWrite = vi.fn().mockResolvedValue({ matchedCount: 1 });

    expect(await repository({
      bulkWrite: bulkWrite as never,
      find: find as never,
    }).reposition({
      beforePlayId: null,
      placement: { kind: "calendar", scheduledDate: "2026-09-07" },
      playIds: [playId.toHexString()],
    })).toBe(true);

    expect(find.mock.calls[1][0]).toMatchObject({
      is_active: true,
      is_deleted: false,
      task_date: {
        $gte: new Date("2026-09-07T00:00:00.000Z"),
        $lt: new Date("2026-09-08T00:00:00.000Z"),
      },
      user_id: 43,
    });
    const values = bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(values.task_date).toEqual(new Date("2026-09-07T00:00:00.000Z"));
    expect(values).not.toHaveProperty("task_type");
    expect(values).not.toHaveProperty("contact_id");
    expect(values).not.toHaveProperty("note");
    expect(values).not.toHaveProperty("place");
  });

  it("promotes due Reminders to deterministic top Headlines with scoped targeted sets", async () => {
    const dueFirst = new ObjectId();
    const dueSecond = new ObjectId();
    const existingHeadline = new ObjectId();
    const find = vi.fn()
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { _id: dueFirst, priority_index: "10-00000100", task_date: new Date("2026-09-05T00:00:00Z"), task_type: "S" },
            { _id: dueSecond, priority_index: "10-00000200", task_date: new Date("2026-09-05T00:00:00Z"), task_type: "S" },
          ]),
        }),
      })
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { _id: existingHeadline, priority_index: "10-00000400", task_date: new Date("2026-09-06T00:00:00Z"), task_type: "H" },
          ]),
        }),
      });
    const bulkWrite = vi.fn().mockResolvedValue({ matchedCount: 2 });

    expect(await repository({
      bulkWrite: bulkWrite as never,
      find: find as never,
    }).reconcileDueReminders("2026-09-06")).toBe(true);

    expect(find.mock.calls[0][0]).toEqual({
      "carnival_google.semantic_role": { $ne: "place" },
      is_active: true,
      is_deleted: false,
      task_date: { $lt: new Date("2026-09-06T00:00:00.000Z"), $type: "date" },
      task_type: "S",
      user_id: 43,
    });
    const operations = bulkWrite.mock.calls[0][0];
    expect(operations).toHaveLength(2);
    expect(operations.map((operation: { updateOne: { filter: { _id: ObjectId } } }) =>
      operation.updateOne.filter._id.toHexString()
    )).toEqual([dueFirst.toHexString(), dueSecond.toHexString()]);
    for (const operation of operations) {
      expect(operation.updateOne.filter).toMatchObject({
        is_active: true,
        is_deleted: false,
        task_type: "S",
        user_id: 43,
      });
      expect(operation.updateOne.update).toEqual({
        $set: {
          priority_index: expect.stringMatching(/^10-[0-9A-F]{8}$/),
          task_date: new Date("2026-09-06T00:00:00.000Z"),
          task_type: "H",
          updated_date: expect.any(Date),
        },
      });
    }
    expect(operations[0].updateOne.update.$set.priority_index <
      operations[1].updateOne.update.$set.priority_index).toBe(true);
    expect(operations[1].updateOne.update.$set.priority_index < "10-00000400").toBe(true);
  });

  it("is idempotent when no active due Reminder matches", async () => {
    const bulkWrite = vi.fn();
    const find = vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    expect(await repository({
      bulkWrite: bulkWrite as never,
      find: find as never,
    }).reconcileDueReminders("2026-09-06")).toBe(true);
    expect(find).toHaveBeenCalledOnce();
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});
