import { describe, expect, it, vi } from "vitest";

import { runExactDriveBackfill } from "./drive-backfill";

describe("exact Drive folder backfill", () => {
  it("counts only read-back-verified identities as resolved", async () => {
    const cached = vi.fn(async () => undefined);
    const summary = await runExactDriveBackfill({
      cache: cached,
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(145),
      readBack: async () => [{
        driveFolderId: "BFLX123",
        driveWebUrl: "https://drive.google.com/drive/folders/BFLX123",
        relativePath: "Blue Field Law/Automation/BFLX",
      }],
      resolve: async () => ({
        folders: [{
          folderId: "BFLX123",
          relativePath: "Blue Field Law/Automation/BFLX",
          webUrl: "https://drive.google.com/drive/folders/BFLX123",
        }],
        status: "resolved",
      }),
      targets: [{
        driveFolderId: null,
        driveWebUrl: null,
        relativePath: "Blue Field Law/Automation/BFLX",
      }],
    });
    expect(summary).toMatchObject({
      alreadyResolved: 0,
      durationMs: 45,
      errors: 0,
      processed: 1,
      resolved: 1,
    });
    expect(cached).toHaveBeenCalledOnce();
  });

  it("reports already-resolved, not-found, ambiguous, and API-error categories", async () => {
    const summary = await runExactDriveBackfill({
      cache: async () => undefined,
      readBack: async () => [],
      resolve: async (path) => {
        if (path === "Missing") return { relativePath: path, status: "not_found" };
        if (path === "Duplicate") return { candidateCount: 2, relativePath: path, status: "ambiguous" };
        throw new Error("API unavailable");
      },
      targets: [
        { driveFolderId: "KNOWN", driveWebUrl: null, relativePath: "Known" },
        { driveFolderId: null, driveWebUrl: null, relativePath: "Missing" },
        { driveFolderId: null, driveWebUrl: null, relativePath: "Duplicate" },
        { driveFolderId: null, driveWebUrl: null, relativePath: "Broken" },
      ],
    });
    expect(summary).toMatchObject({
      alreadyResolved: 1,
      ambiguous: 1,
      errors: 1,
      notFound: 1,
      processed: 4,
      resolved: 0,
    });
    expect(summary.unresolved).toEqual([
      { relativePath: "Missing", status: "not_found" },
      { relativePath: "Duplicate", status: "ambiguous" },
      { relativePath: "Broken", status: "api_error" },
    ]);
  });

  it("does not claim success when a resolved API identity is absent after persistence", async () => {
    const summary = await runExactDriveBackfill({
      cache: async () => undefined,
      readBack: async () => [],
      resolve: async () => ({
        folders: [{ folderId: "ID1", relativePath: "Branch", webUrl: "https://drive.google.com/drive/folders/ID1" }],
        status: "resolved",
      }),
      targets: [{ driveFolderId: null, driveWebUrl: null, relativePath: "Branch" }],
    });
    expect(summary.resolved).toBe(0);
    expect(summary.errors).toBe(1);
    expect(summary.unresolved).toEqual([{ relativePath: "Branch", status: "db_error" }]);
  });
});
