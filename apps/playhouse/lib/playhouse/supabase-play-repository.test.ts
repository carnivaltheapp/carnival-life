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
