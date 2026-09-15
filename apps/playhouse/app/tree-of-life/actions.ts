"use server";

import type { DriveBackfillState } from "../../domain/drive-backfill";
import {
  treeOfLifeRelativePathFromBranch,
  type BranchTreeNode,
  type FolderTreeNode,
} from "../../domain/tree-of-life";
import { isUuid } from "../../domain/play-input";
import { runExactDriveBackfill } from "../../lib/google/drive-backfill";
import { createDriveHierarchyResolver } from "../../lib/google/drive.server";
import { GOOGLE_DRIVE_METADATA_READONLY_SCOPE } from "../../lib/google/scopes";
import { GoogleAccountReconnectRequiredError } from "../../lib/google/token-broker";
import { createClient } from "../../lib/supabase/server";
import { MongoTreeOfLifeRepository } from "../../lib/tree-of-life/repository";

type BranchTreeResult = {
  branches: BranchTreeNode[];
  initialized: boolean;
  message?: string;
  ok: boolean;
};

async function authenticatedOwnerId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const ownerUserId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  return error ? null : ownerUserId;
}

async function driveAccountForOwner(ownerUserId: string, requestedAccountId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("google_accounts")
    .select("id, connection_status, granted_scopes")
    .eq("owner_user_id", ownerUserId);
  if (requestedAccountId) query = query.eq("id", requestedAccountId);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) return { accountId: null, status: "unavailable" as const };
  const authorized = data.filter((account) =>
    account.connection_status === "connected" &&
    account.granted_scopes.includes(GOOGLE_DRIVE_METADATA_READONLY_SCOPE)
  );
  if (authorized.length === 1) return { accountId: authorized[0].id, status: "ready" as const };
  return {
    accountId: null,
    status: authorized.length > 1 ? "account_required" as const : "auth_required" as const,
  };
}

export async function loadTreeOfLifeBranches(): Promise<BranchTreeResult> {
  const ownerUserId = await authenticatedOwnerId();
  if (!ownerUserId) return { branches: [], initialized: false, message: "Session unavailable.", ok: false };
  try {
    const branches = await new MongoTreeOfLifeRepository().getBranchTreeForOwner(ownerUserId);
    return { branches, initialized: branches.length > 0, ok: true };
  } catch (error) {
    console.error("[Tree of Life] Mongo read failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return { branches: [], initialized: false, message: "Branches unavailable.", ok: false };
  }
}

export async function loadTreeOfLifeFolders(): Promise<{
  folders: FolderTreeNode[];
  message?: string;
  ok: boolean;
}> {
  const ownerUserId = await authenticatedOwnerId();
  if (!ownerUserId) return { folders: [], message: "Session unavailable.", ok: false };
  try {
    return {
      folders: await new MongoTreeOfLifeRepository().getFolderTreeForOwner(ownerUserId),
      ok: true,
    };
  } catch (error) {
    console.error("[Tree of Life] all-folder Mongo read failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return { folders: [], message: "Folders unavailable.", ok: false };
  }
}

export async function resolveTreeOfLifeDriveDestination(relativePath: string) {
  const ownerUserId = await authenticatedOwnerId();
  if (!ownerUserId) return null;
  const repository = new MongoTreeOfLifeRepository();
  let normalizedPath: string;
  try {
    normalizedPath = treeOfLifeRelativePathFromBranch(relativePath);
  } catch {
    console.error("CARNIVAL_DRIVE_RESOLVE ERROR", { category: "ROOT_MAPPING_ERROR", relativePath });
    console.info("HOT_TAB_DRIVE_UNRESOLVED", { relativePath });
    return null;
  }
  try {
    console.info("HOT_TAB_DRIVE_LOOKUP", { relativePath: normalizedPath });
    const cachedUrl = await repository.resolveDriveFolderForOwner(ownerUserId, normalizedPath);
    if (cachedUrl) {
      console.info("HOT_TAB_DRIVE_CACHE_HIT", { relativePath: normalizedPath });
      return cachedUrl;
    }
    console.info("HOT_TAB_DRIVE_RESOLVE_START", { relativePath: normalizedPath });
    console.info("CARNIVAL_DRIVE_RESOLVE START", { mode: "on_demand", relativePath: normalizedPath });
    const account = await driveAccountForOwner(ownerUserId);
    if (!account.accountId) {
      console.warn("DRIVE_AUTH_REQUIRED", { relativePath: normalizedPath, status: account.status });
      return null;
    }
    const resolver = await createDriveHierarchyResolver({
      googleAccountId: account.accountId,
      ownerUserId,
    });
    const result = await resolver.resolve(normalizedPath);
    if (result.status === "auth_required") {
      console.warn("DRIVE_AUTH_REQUIRED", { relativePath: normalizedPath });
      return null;
    }
    if (result.status === "ambiguous") {
      console.warn("DRIVE_FOLDER_AMBIGUOUS", {
        candidateCount: result.candidateCount,
        relativePath: result.relativePath,
      });
      return null;
    }
    if (result.status === "not_found") {
      console.warn("DRIVE_FOLDER_NOT_FOUND", { relativePath: result.relativePath });
      return null;
    }
    await repository.cacheDriveFolderIdentities(ownerUserId, result.folders);
    const driveUrl = await repository.resolveDriveFolderForOwner(ownerUserId, normalizedPath);
    if (!driveUrl) {
      console.error("CARNIVAL_DRIVE_RESOLVE ERROR", { category: "DB_ERROR", relativePath: normalizedPath });
      return null;
    }
    console.info("DRIVE_ID_CACHED", { count: result.folders.length, relativePath: normalizedPath });
    console.info("HOT_TAB_DRIVE_RESOLVED", { relativePath: normalizedPath });
    console.info("CARNIVAL_DRIVE_RESOLVE COMPLETE", { mode: "on_demand", relativePath: normalizedPath });
    return driveUrl;
  } catch (error) {
    if (error instanceof GoogleAccountReconnectRequiredError) {
      console.warn("DRIVE_AUTH_REQUIRED", { relativePath });
      return null;
    }
    console.warn("HOT_TAB_DRIVE_UNRESOLVED", {
      message: error instanceof Error ? error.message : "Unknown error",
      relativePath,
    });
    return null;
  }
}

export async function backfillTreeOfLifeDriveFolders(
  _previousState: DriveBackfillState,
  formData: FormData,
): Promise<DriveBackfillState> {
  const googleAccountId = formData.get("googleAccountId");
  if (typeof googleAccountId !== "string" || !isUuid(googleAccountId)) {
    return { message: "Choose a Google account.", status: "error" };
  }
  const ownerUserId = await authenticatedOwnerId();
  if (!ownerUserId) return { message: "Session unavailable.", status: "error" };
  const account = await driveAccountForOwner(ownerUserId, googleAccountId);
  if (!account.accountId) {
    console.warn("DRIVE_AUTH_REQUIRED", { googleAccountId, status: account.status });
    return {
      message: "Google Drive reconnect required. Sign out and sign in with Google to grant access.",
      status: "error",
    };
  }

  const repository = new MongoTreeOfLifeRepository();
  const startedAt = Date.now();
  let stage: "auth" | "load" | "resolve" | "persist" = "load";
  try {
    const targets = await repository.listDriveResolutionTargets(ownerUserId, true);
    stage = "auth";
    const resolver = await createDriveHierarchyResolver({ googleAccountId, ownerUserId });
    console.info("CARNIVAL_DRIVE_RESOLVE START", {
      accountId: googleAccountId,
      count: targets.length,
      mode: "branch_backfill",
    });
    stage = "resolve";
    const summary = await runExactDriveBackfill({
      cache: async (folders) => {
        stage = "persist";
        await repository.cacheDriveFolderIdentities(ownerUserId, folders);
      },
      readBack: (relativePaths) => repository.readDriveFolderIdentitiesForOwner(ownerUserId, relativePaths),
      resolve: (relativePath) => resolver.resolve(relativePath),
      targets,
    });
    console.info("CARNIVAL_DRIVE_RESOLVE COMPLETE", { ...summary, unresolved: summary.unresolved.length });
    if (summary.authRequired) {
      console.warn("DRIVE_AUTH_REQUIRED", { googleAccountId });
      return {
        message: "Google Drive reconnect required. Sign out and sign in with Google to grant access.",
        status: "error",
        summary,
      };
    }
    return {
      message: "Drive folder resolution complete.",
      status: "success",
      summary,
    };
  } catch (error) {
    if (error instanceof GoogleAccountReconnectRequiredError) {
      console.warn("DRIVE_AUTH_REQUIRED", { googleAccountId });
      return {
        message: "Google Drive reconnect required. Sign out and sign in with Google to grant access.",
        status: "error",
      };
    }
    const category = stage === "auth" ? "AUTH_REQUIRED" : stage === "resolve" ? "API_ERROR" : "DB_ERROR";
    console.error("CARNIVAL_DRIVE_RESOLVE ERROR", {
      category,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      message: `Drive folder resolution failed: ${
        category === "AUTH_REQUIRED"
          ? "Google authorization error."
          : category === "API_ERROR" ? "Google Drive API error." : "database update error."
      }`,
      status: "error",
    };
  }
}

export async function bootstrapTreeOfLife(tree: unknown): Promise<BranchTreeResult & {
  branchCount?: number;
  topLevelCount?: number;
}> {
  const ownerUserId = await authenticatedOwnerId();
  if (!ownerUserId) return { branches: [], initialized: false, message: "Session unavailable.", ok: false };
  try {
    const repository = new MongoTreeOfLifeRepository();
    const result = await repository.upsertBootstrapTree(ownerUserId, tree);
    const branches = await repository.getBranchTreeForOwner(ownerUserId);
    return {
      branches,
      branchCount: result.branchCount,
      initialized: true,
      message: result.initialized ? "Tree of Life imported." : "Tree of Life is already imported.",
      ok: true,
      topLevelCount: result.topLevelCount,
    };
  } catch (error) {
    console.error("[Tree of Life] bootstrap failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return { branches: [], initialized: false, message: "Tree of Life could not be imported.", ok: false };
  }
}
