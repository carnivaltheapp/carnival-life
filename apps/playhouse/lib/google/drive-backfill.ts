import type { DriveBackfillSummary } from "../../domain/drive-backfill";
import { exactDriveFolderUrl } from "../../domain/tree-of-life-drive";
import type { DriveFolderResolution, ResolvedDriveFolder } from "./drive";

export type DriveResolutionTarget = {
  driveFolderId: string | null;
  driveWebUrl: string | null;
  relativePath: string;
};

type ExactDriveBackfillInput = {
  cache: (folders: ResolvedDriveFolder[]) => Promise<unknown>;
  now?: () => number;
  readBack: (relativePaths: string[]) => Promise<DriveResolutionTarget[]>;
  resolve: (relativePath: string) => Promise<DriveFolderResolution>;
  targets: DriveResolutionTarget[];
};

export async function runExactDriveBackfill({
  cache,
  now = Date.now,
  readBack,
  resolve,
  targets,
}: ExactDriveBackfillInput): Promise<DriveBackfillSummary> {
  const startedAt = now();
  const summary: DriveBackfillSummary = {
    alreadyResolved: targets.filter((target) => Boolean(exactDriveFolderUrl(target))).length,
    ambiguous: 0,
    authRequired: 0,
    durationMs: 0,
    errors: 0,
    notFound: 0,
    processed: targets.length,
    resolved: 0,
    unresolved: [],
  };
  const pending = targets.filter((target) => !exactDriveFolderUrl(target));
  const identities = new Map<string, ResolvedDriveFolder>();
  const expectedLeaves = new Map<string, ResolvedDriveFolder>();

  for (const target of pending) {
    let result: DriveFolderResolution;
    try {
      result = await resolve(target.relativePath);
    } catch {
      summary.errors += 1;
      console.error("CARNIVAL_DRIVE_RESOLVE ERROR", {
        category: "API_ERROR",
        relativePath: target.relativePath,
      });
      if (summary.unresolved.length < 5) {
        summary.unresolved.push({ relativePath: target.relativePath, status: "api_error" });
      }
      continue;
    }
    if (result.status === "auth_required") {
      summary.authRequired += 1;
      console.warn("CARNIVAL_DRIVE_RESOLVE ERROR", {
        category: "AUTH_REQUIRED",
        relativePath: target.relativePath,
      });
      break;
    }
    if (result.status === "ambiguous") {
      summary.ambiguous += 1;
      console.warn("DRIVE_FOLDER_AMBIGUOUS", {
        candidateCount: result.candidateCount,
        relativePath: result.relativePath,
      });
      if (summary.unresolved.length < 5) {
        summary.unresolved.push({ relativePath: target.relativePath, status: "ambiguous" });
      }
      continue;
    }
    if (result.status === "not_found") {
      summary.notFound += 1;
      console.warn("DRIVE_FOLDER_NOT_FOUND", { relativePath: result.relativePath });
      if (summary.unresolved.length < 5) {
        summary.unresolved.push({ relativePath: target.relativePath, status: "not_found" });
      }
      continue;
    }
    for (const folder of result.folders) identities.set(folder.relativePath, folder);
    const leaf = result.folders.at(-1);
    if (leaf) expectedLeaves.set(target.relativePath, leaf);
  }

  if (identities.size) {
    await cache([...identities.values()]);
    console.info("DRIVE_ID_CACHED", { count: identities.size, mode: "branch_backfill" });
  }
  if (expectedLeaves.size) {
    const persisted = await readBack([...expectedLeaves.keys()]);
    const persistedByPath = new Map(persisted.map((folder) => [folder.relativePath, folder]));
    for (const [relativePath, expected] of expectedLeaves) {
      const actual = persistedByPath.get(relativePath);
      if (actual?.driveFolderId === expected.folderId && exactDriveFolderUrl(actual) === expected.webUrl) {
        summary.resolved += 1;
      } else {
        summary.errors += 1;
        if (summary.unresolved.length < 5) {
          summary.unresolved.push({ relativePath, status: "db_error" });
        }
      }
    }
  }
  summary.durationMs = Math.max(0, now() - startedAt);
  return summary;
}
