import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MongoGmailWatchRepository, type GmailWatchState } from "./gmail-watch-repository";

function state(historyId = "100"): GmailWatchState {
  const now = new Date("2026-09-16T12:00:00.000Z");
  return {
    created_at: now,
    email: "owner@example.com",
    expiration: new Date("2026-09-20T12:00:00.000Z"),
    google_account_id: "account-1",
    history_id: historyId,
    last_error: null,
    last_notification_at: null,
    locked_until: null,
    owner_user_id: "owner-1",
    status: "active",
    updated_at: now,
  };
}

describe("durable Gmail history cursor", () => {
  it("preserves the processed cursor during ordinary watch renewal", async () => {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const repository = new MongoGmailWatchRepository(async () => ({ updateOne }) as never);
    await repository.upsertWatch({
      email: "owner@example.com",
      expiration: new Date("2026-09-20T12:00:00.000Z"),
      googleAccountId: "account-1",
      historyId: "new-watch-baseline",
      ownerUserId: "owner-1",
    });
    const update = updateOne.mock.calls[0]?.[1] as {
      $set: Record<string, unknown>;
      $setOnInsert: Record<string, unknown>;
    };
    expect(update.$set).not.toHaveProperty("history_id");
    expect(update.$setOnInsert.history_id).toBe("new-watch-baseline");
  });

  it("treats duplicate and older notifications as already processed", async () => {
    const findOneAndUpdate = vi.fn();
    const repository = new MongoGmailWatchRepository(async () => ({
      findOne: vi.fn().mockResolvedValue(state("100")),
      findOneAndUpdate,
    }) as never);
    await expect(repository.claimNotification("account-1", "100")).resolves
      .toMatchObject({ duplicate: true });
    await expect(repository.claimNotification("account-1", "99")).resolves
      .toMatchObject({ duplicate: true });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("returns busy when another delivery owns the mailbox lease", async () => {
    const repository = new MongoGmailWatchRepository(async () => ({
      findOne: vi.fn().mockResolvedValue(state("100")),
      findOneAndUpdate: vi.fn().mockResolvedValue(null),
    }) as never);
    await expect(repository.claimNotification("account-1", "101")).resolves
      .toMatchObject({ busy: true, duplicate: false });
  });
});
