"use server";

import { revalidatePath } from "next/cache";

import type { BranchTreeNode, FolderTreeNode } from "../../domain/tree-of-life";
import { isUuid } from "../../domain/play-input";
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
  try {
    const cachedUrl = await repository.resolveDriveFolderForOwner(ownerUserId, relativePath);
    if (cachedUrl) return cachedUrl;
    console.info("DRIVE_RESOLVE_START", { relativePath });
    const account = await driveAccountForOwner(ownerUserId);
    if (!account.accountId) {
      console.warn("DRIVE_AUTH_REQUIRED", { relativePath, status: account.status });
      return null;
    }
    const resolver = await createDriveHierarchyResolver({
      googleAccountId: account.accountId,
      ownerUserId,
    });
    const result = await resolver.resolve(relativePath);
    if (result.status === "auth_required") {
      console.warn("DRIVE_AUTH_REQUIRED", { relativePath });
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
    console.info("DRIVE_ID_CACHED", { count: result.folders.length, relativePath });
    console.info("DRIVE_RESOLVE_COMPLETE", { relativePath });
    return result.folders.at(-1)?.webUrl ?? null;
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

export type DriveBackfillState = {
  message?: string;
  status: "idle" | "success" | "error";
};

export const INITIAL_DRIVE_BACKFILL_STATE: DriveBackfillState = { status: "idle" };

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
  try {
    const paths = await repository.listDriveResolutionPaths(ownerUserId, true);
    const resolver = await createDriveHierarchyResolver({ googleAccountId, ownerUserId });
    const identities = new Map<string, { folderId: string; relativePath: string; webUrl: string }>();
    let ambiguous = 0;
    let notFound = 0;
    let resolved = 0;
    console.info("DRIVE_RESOLVE_START", { count: paths.length, mode: "branch_backfill" });
    for (const relativePath of paths) {
      const result = await resolver.resolve(relativePath);
      if (result.status === "auth_required") {
        console.warn("DRIVE_AUTH_REQUIRED", { relativePath });
        return {
          message: "Google Drive reconnect required. Sign out and sign in with Google to grant access.",
          status: "error",
        };
      }
      if (result.status === "ambiguous") {
        ambiguous += 1;
        console.warn("DRIVE_FOLDER_AMBIGUOUS", {
          candidateCount: result.candidateCount,
          relativePath: result.relativePath,
        });
        continue;
      }
      if (result.status === "not_found") {
        notFound += 1;
        console.warn("DRIVE_FOLDER_NOT_FOUND", { relativePath: result.relativePath });
        continue;
      }
      resolved += 1;
      for (const folder of result.folders) identities.set(folder.relativePath, folder);
    }
    await repository.cacheDriveFolderIdentities(ownerUserId, [...identities.values()]);
    console.info("DRIVE_ID_CACHED", { count: identities.size, mode: "branch_backfill" });
    console.info("DRIVE_RESOLVE_COMPLETE", { ambiguous, notFound, resolved });
    revalidatePath("/");
    return {
      message: `${resolved} Branch${resolved === 1 ? "" : "es"} resolved; ${notFound} not found; ${ambiguous} ambiguous.`,
      status: "success",
    };
  } catch (error) {
    if (error instanceof GoogleAccountReconnectRequiredError) {
      console.warn("DRIVE_AUTH_REQUIRED", { googleAccountId });
      return {
        message: "Google Drive reconnect required. Sign out and sign in with Google to grant access.",
        status: "error",
      };
    }
    console.error("[Tree of Life] Drive backfill failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return { message: "Drive folder IDs could not be resolved.", status: "error" };
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
