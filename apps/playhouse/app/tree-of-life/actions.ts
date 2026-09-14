"use server";

import type { BranchTreeNode, FolderTreeNode } from "../../domain/tree-of-life";
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
