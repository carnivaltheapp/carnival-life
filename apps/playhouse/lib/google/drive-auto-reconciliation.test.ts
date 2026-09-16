import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DRIVE_RETRY_DELAYS_MS,
  MongoDriveReconciliationRepository,
  enqueueDriveIdentity,
  processDriveIdentityQueue,
} from "./drive-auto-reconciliation";

function job(overrides: Record<string, unknown> = {}) {
  return {
    attempt_count: 0,
    created_at: new Date("2026-09-15T12:00:00Z"),
    last_attempt_at: null,
    last_error: null,
    locked_until: null,
    next_attempt_at: new Date("2026-09-15T12:00:00Z"),
    owner_user_id: "owner-a",
    priority: 0,
    relative_path: "Blue Field Law/Automation/BFLX",
    resolved_at: null,
    short_term_exhausted: false,
    status: "pending" as const,
    updated_at: new Date("2026-09-15T12:00:00Z"),
    ...overrides,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const jobs = {
    claimDue: vi.fn().mockResolvedValueOnce(job()).mockResolvedValue(null),
    enqueue: vi.fn(),
    resolve: vi.fn(),
    retry: vi.fn().mockResolvedValue({ attemptCount: 1, delay: 15_000, shortTermExhausted: false }),
  };
  const tree = {
    cacheDriveFolderIdentities: vi.fn(),
    listDriveResolutionTargets: vi.fn().mockResolvedValue([]),
    readDriveFolderIdentitiesForOwner: vi.fn().mockResolvedValue([]),
  };
  return {
    accountForOwner: vi.fn().mockResolvedValue({ accountId: "google-a", status: "ready" }),
    createResolver: vi.fn().mockResolvedValue({
      resolve: vi.fn().mockResolvedValue({
        relativePath: "Blue Field Law/Automation/BFLX",
        status: "not_found",
      }),
    }),
    jobs,
    tree,
    ...overrides,
  };
}

describe("automatic Drive identity reconciliation", () => {
  it("queues one owner/path job idempotently and gives Branches priority", async () => {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const repository = new MongoDriveReconciliationRepository(
      async () => ({ updateOne }) as never,
    );

    await repository.enqueue("owner-a", "Work/Branch", true);
    await repository.enqueue("owner-a", "Work/Branch", true);

    expect(updateOne).toHaveBeenCalledTimes(2);
    expect(updateOne).toHaveBeenLastCalledWith(
      { owner_user_id: "owner-a", relative_path: "Work/Branch" },
      expect.objectContaining({
        $min: { priority: 0 },
        $setOnInsert: expect.objectContaining({ next_attempt_at: expect.any(Date), status: "pending" }),
      }),
      { upsert: true },
    );
    expect(updateOne.mock.calls[1][1].$set).not.toHaveProperty("next_attempt_at");
  });

  it("claims due Branch jobs before ordinary folders", async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue(null);
    const repository = new MongoDriveReconciliationRepository(
      async () => ({ findOneAndUpdate }) as never,
    );
    await repository.claimDue("owner-a", new Date("2026-09-15T12:00:00Z"));
    expect(findOneAndUpdate.mock.calls[0][2]).toMatchObject({
      sort: { priority: 1, next_attempt_at: 1, created_at: 1 },
    });
  });

  it("keeps a newly created local folder pending when Drive has not synced it", async () => {
    const deps = dependencies();
    await expect(processDriveIdentityQueue("owner-a", {}, deps as never)).resolves.toBe(1);
    expect(deps.jobs.retry).toHaveBeenCalledWith(
      expect.objectContaining({ relative_path: "Blue Field Law/Automation/BFLX" }),
      "pending",
      "not_found",
      expect.any(Date),
    );
    expect(deps.tree.cacheDriveFolderIdentities).not.toHaveBeenCalled();
  });

  it("later caches the exact folder identity and resolves the same durable job", async () => {
    const deps = dependencies();
    deps.createResolver.mockResolvedValue({
      resolve: vi.fn().mockResolvedValue({
        folders: [{
          folderId: "BFLX123",
          relativePath: "Blue Field Law/Automation/BFLX",
          webUrl: "https://drive.google.com/drive/folders/BFLX123",
        }],
        status: "resolved",
      }),
    });
    deps.tree.readDriveFolderIdentitiesForOwner
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        driveFolderId: "BFLX123",
        driveWebUrl: "https://drive.google.com/drive/folders/BFLX123",
        relativePath: "Blue Field Law/Automation/BFLX",
      }]);

    await processDriveIdentityQueue("owner-a", {}, deps as never);

    expect(deps.tree.cacheDriveFolderIdentities).toHaveBeenCalledWith("owner-a", [
      expect.objectContaining({ folderId: "BFLX123" }),
    ]);
    expect(deps.jobs.resolve).toHaveBeenCalledWith(
      "owner-a",
      "Blue Field Law/Automation/BFLX",
      expect.any(Date),
    );
  });

  it("survives missing authorization and resolves after authorization recovers", async () => {
    const unauthorized = dependencies({
      accountForOwner: vi.fn().mockResolvedValue({ accountId: null, status: "auth_required" }),
    });
    await processDriveIdentityQueue("owner-a", {}, unauthorized as never);
    expect(unauthorized.jobs.retry).toHaveBeenCalledWith(
      expect.anything(),
      "auth_required",
      "auth_required",
      expect.any(Date),
    );

    const recovered = dependencies();
    recovered.createResolver.mockResolvedValue({
      resolve: vi.fn().mockResolvedValue({
        folders: [{
          folderId: "BFLX123",
          relativePath: "Blue Field Law/Automation/BFLX",
          webUrl: "https://drive.google.com/drive/folders/BFLX123",
        }],
        status: "resolved",
      }),
    });
    recovered.tree.readDriveFolderIdentitiesForOwner
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        driveFolderId: "BFLX123",
        driveWebUrl: "https://drive.google.com/drive/folders/BFLX123",
        relativePath: "Blue Field Law/Automation/BFLX",
      }]);
    await processDriveIdentityQueue("owner-a", {}, recovered as never);
    expect(recovered.jobs.resolve).toHaveBeenCalled();
  });

  it("does not call Supabase when no reconciliation job is due", async () => {
    const deps = dependencies();
    deps.jobs.claimDue.mockReset().mockResolvedValue(null);
    await expect(processDriveIdentityQueue("owner-a", {}, deps as never)).resolves.toBe(0);
    expect(deps.accountForOwner).not.toHaveBeenCalled();
  });

  it("does not requeue a folder that already has a cached exact identity", async () => {
    const deps = dependencies();
    deps.tree.readDriveFolderIdentitiesForOwner.mockResolvedValue([{
      driveFolderId: "BFLX123",
      driveWebUrl: "https://drive.google.com/drive/folders/BFLX123",
      relativePath: "Blue Field Law/Automation/BFLX",
    }]);
    await expect(enqueueDriveIdentity(
      "owner-a",
      "Blue Field Law/Automation/BFLX",
      true,
      deps as never,
    )).resolves.toBe(false);
    expect(deps.jobs.enqueue).not.toHaveBeenCalled();
    expect(deps.jobs.resolve).toHaveBeenCalled();
  });

  it("uses bounded backoff and continues periodic retries after the short-term window", async () => {
    expect(DRIVE_RETRY_DELAYS_MS).toEqual([15_000, 30_000, 60_000, 120_000, 300_000, 900_000]);
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const repository = new MongoDriveReconciliationRepository(
      async () => ({ updateOne }) as never,
    );
    await expect(repository.retry(job({ attempt_count: 5 }), "pending", "not_found"))
      .resolves.toMatchObject({ delay: 900_000, shortTermExhausted: true });
    expect(updateOne.mock.calls[0][1].$set.next_attempt_at).toBeInstanceOf(Date);
  });

  it("retargets an unresolved durable job on rename or move", async () => {
    const jobs = [job()];
    const toArray = vi.fn().mockResolvedValue(jobs);
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const repository = new MongoDriveReconciliationRepository(
      async () => ({ find: vi.fn(() => ({ toArray })), updateOne }) as never,
    );
    await repository.retargetPrefix(
      "owner-a",
      "Blue Field Law/Automation/BFLX",
      "Blue Field Law/Technology/BFLX",
    );
    expect(updateOne).toHaveBeenCalledWith(
      { owner_user_id: "owner-a", relative_path: "Blue Field Law/Automation/BFLX" },
      { $set: expect.objectContaining({ relative_path: "Blue Field Law/Technology/BFLX" }) },
    );
  });

  it("cancels only the deleted owner/path subtree without issuing a Drive delete", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 2 });
    const repository = new MongoDriveReconciliationRepository(
      async () => ({ deleteMany }) as never,
    );
    await repository.cancelPrefix("owner-a", "Blue Field Law/Automation/BFLX");
    expect(deleteMany).toHaveBeenCalledWith({
      owner_user_id: "owner-a",
      relative_path: { $regex: "^Blue Field Law/Automation/BFLX(?:/|$)" },
    });
  });
});
