import { describe, expect, it, vi } from "vitest";

import { SupabasePlayRepository } from "./supabase-play-repository";

function query(result: { count?: number | null; data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: PromiseLike<unknown>["then"];
  } = {};
  for (const method of [
    "eq", "in", "is", "lt", "maybeSingle", "order", "select", "update",
  ]) {
    builder[method] = vi.fn(() => method === "maybeSingle"
      ? Promise.resolve(result)
      : builder);
  }
  builder.then = (onfulfilled, onrejected) =>
    Promise.resolve(result).then(onfulfilled, onrejected);
  return builder;
}

describe("Supabase Reminder reconciliation", () => {
  it("promotes only the owner-scoped open due Reminder to today's top Headline", async () => {
    const due = query({
      data: [{ id: "due-reminder", sort_order: 9000 }],
      error: null,
    });
    const headlines = query({
      data: [{ id: "headline", sort_order: 3000 }],
      error: null,
    });
    const update = query({ data: { id: "due-reminder" }, error: null });
    const from = vi.fn()
      .mockReturnValueOnce(due)
      .mockReturnValueOnce(headlines)
      .mockReturnValueOnce(update);

    expect(await new SupabasePlayRepository(
      { from } as never,
      "owner-user",
    ).reconcileDueReminders("2026-09-06")).toBe(true);

    expect(due.eq).toHaveBeenCalledWith("owner_user_id", "owner-user");
    expect(due.eq).toHaveBeenCalledWith("status", "open");
    expect(due.eq).toHaveBeenCalledWith("play_type", "reminder");
    expect(due.is).toHaveBeenCalledWith("basket_id", null);
    expect(due.lt).toHaveBeenCalledWith("scheduled_date", "2026-09-06");
    expect(update.update).toHaveBeenCalledWith({
      basket_id: null,
      play_type: "normal",
      scheduled_date: "2026-09-06",
      sort_order: 1500,
    });
    expect(update.eq).toHaveBeenCalledWith("id", "due-reminder");
    expect(update.eq).toHaveBeenCalledWith("owner_user_id", "owner-user");
    expect(update.eq).toHaveBeenCalledWith("status", "open");
    expect(update.eq).toHaveBeenCalledWith("play_type", "reminder");
  });

  it("is a no-op when there are no active due Reminders", async () => {
    const due = query({ data: [], error: null });
    const from = vi.fn().mockReturnValue(due);
    expect(await new SupabasePlayRepository(
      { from } as never,
      "owner-user",
    ).reconcileDueReminders("2026-09-06")).toBe(true);
    expect(from).toHaveBeenCalledOnce();
    expect(due.update).not.toHaveBeenCalled();
  });
});

describe("Supabase Play lifecycle identity", () => {
  it("loads the owner-scoped open Gmail source and thread identity", async () => {
    const play = query({
      data: {
        source_metadata: { external_ids: { thread_id: "thread-1" } },
        source_type: "gmail",
      },
      error: null,
    });
    const from = vi.fn().mockReturnValue(play);

    await expect(new SupabasePlayRepository(
      { from } as never,
      "owner-user",
    ).getLifecycleIdentity("play-1")).resolves.toEqual({
      gmailThreadId: "thread-1",
      sourceType: "gmail",
    });
    expect(play.eq).toHaveBeenCalledWith("id", "play-1");
    expect(play.eq).toHaveBeenCalledWith("owner_user_id", "owner-user");
    expect(play.eq).toHaveBeenCalledWith("status", "open");
  });
});

describe("Supabase Gmail attachment", () => {
  it("merges and replaces Gmail metadata without changing source or unrelated fields", async () => {
    const existing = query({
      data: {
        source_metadata: {
          external_ids: { event_id: "event-1", thread_id: "old" },
          legacy_source: { task_type: "H" },
        },
      },
      error: null,
    });
    const update = query({ data: { id: "play-1" }, error: null });
    const from = vi.fn().mockReturnValueOnce(existing).mockReturnValueOnce(update);

    expect(await new SupabasePlayRepository(
      { from } as never,
      "owner-user",
    ).attachGmail({
      attachment: {
        accountIndex: 3,
        canonicalUrl: "https://mail.google.com/mail/u/3/#all/FMnew",
        threadRef: "FMnew",
      },
      playId: "play-1",
    })).toBe(true);

    expect(existing.eq).toHaveBeenCalledWith("owner_user_id", "owner-user");
    expect(existing.eq).toHaveBeenCalledWith("status", "open");
    expect(update.update).toHaveBeenCalledWith({
      source_metadata: {
        external_ids: { event_id: "event-1", thread_id: "FMnew" },
        gmail_attachment: {
          account_index: 3,
          canonical_url: "https://mail.google.com/mail/u/3/#all/FMnew",
          thread_ref: "FMnew",
        },
        legacy_source: { task_type: "H" },
      },
    });
    expect(update.eq).toHaveBeenCalledWith("owner_user_id", "owner-user");
    expect(update.eq).toHaveBeenCalledWith("status", "open");
  });

  it("rejects Appointment attachment before issuing an update", async () => {
    const existing = query({
      data: { source_metadata: { legacy_source: { task_type: "A" } } },
      error: null,
    });
    const from = vi.fn().mockReturnValue(existing);
    expect(await new SupabasePlayRepository(
      { from } as never,
      "owner-user",
    ).attachGmail({
      attachment: {
        accountIndex: 0,
        canonicalUrl: "https://mail.google.com/mail/u/0/#all/FMnew",
        threadRef: "FMnew",
      },
      playId: "appointment-1",
    })).toBe(false);
    expect(from).toHaveBeenCalledOnce();
    expect(existing.update).not.toHaveBeenCalled();
  });

  it("unlinks Gmail and clears only the Play assignee through an owner-scoped update", async () => {
    const existing = query({
      data: {
        source_metadata: {
          external_ids: { event_id: "event-1", thread_id: "FMnew" },
          gmail_attachment: { account_index: 3, thread_ref: "FMnew" },
          legacy_source: { note: "Keep", thread_id: "legacy-thread" },
        },
      },
      error: null,
    });
    const update = query({ data: { id: "play-1" }, error: null });
    const from = vi.fn().mockReturnValueOnce(existing).mockReturnValueOnce(update);
    await expect(new SupabasePlayRepository(
      { from } as never,
      "owner-user",
    ).unlinkGmail({ playId: "play-1" })).resolves.toBe(true);
    expect(update.update).toHaveBeenCalledWith({
      player_contact_id: null,
      source_metadata: {
        external_ids: { event_id: "event-1" },
        legacy_source: { note: "Keep" },
      },
    });
    expect(update.eq).toHaveBeenCalledWith("owner_user_id", "owner-user");
    expect(update.eq).toHaveBeenCalledWith("status", "open");
  });

  it("assigns only the owner-scoped target without changing rank or placement", async () => {
    const update = query({ data: { id: "play-1" }, error: null });
    const from = vi.fn().mockReturnValue(update);
    await expect(new SupabasePlayRepository(
      { from } as never,
      "owner-user",
    ).assignPlayer({
      playId: "play-1",
      playerContactId: "contact-kayla",
      playerResourceName: "people/kayla",
    })).resolves.toBe(true);
    expect(update.update).toHaveBeenCalledWith({ player_contact_id: "contact-kayla" });
    expect(update.eq).toHaveBeenCalledWith("id", "play-1");
    expect(update.eq).toHaveBeenCalledWith("owner_user_id", "owner-user");
    expect(update.eq).toHaveBeenCalledWith("status", "open");
  });
});

describe("Supabase rank flip", () => {
  it("owner-scopes the Play and moves it to the top of its new rank", async () => {
    const play = query({
      data: {
        basket_id: null,
        id: "play-1",
        play_type: "reminder",
        scheduled_date: "2026-09-08",
        source_metadata: {},
      },
      error: null,
    });
    const headlines = query({
      data: [
        {
          id: "appointment-1",
          sort_order: 5000,
          source_metadata: { legacy_source: { task_type: "A" } },
        },
        { id: "headline-1", sort_order: 2000, source_metadata: {} },
      ],
      error: null,
    });
    const update = query({ data: { id: "play-1" }, error: null });
    const from = vi.fn()
      .mockReturnValueOnce(play)
      .mockReturnValueOnce(headlines)
      .mockReturnValueOnce(update);

    expect(await new SupabasePlayRepository(
      { from } as never,
      "owner-user",
    ).flipRank({
      playId: "play-1",
      playType: "normal",
    })).toBe(true);

    expect(play.eq).toHaveBeenCalledWith("owner_user_id", "owner-user");
    expect(headlines.eq).toHaveBeenCalledWith("play_type", "normal");
    expect(update.update).toHaveBeenCalledWith({
      play_type: "normal",
      sort_order: 1000,
    });
    expect(update.eq).toHaveBeenCalledWith("id", "play-1");
    expect(update.eq).toHaveBeenCalledWith("owner_user_id", "owner-user");
    expect(update.eq).toHaveBeenCalledWith("status", "open");
    expect(update.eq).toHaveBeenCalledWith("play_type", "reminder");
  });
});
