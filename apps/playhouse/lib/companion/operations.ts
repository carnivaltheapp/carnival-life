import "server-only";

import { MongoCompanionRepository } from "./repository";
import { MongoTreeOfLifeRepository } from "../tree-of-life/repository";

export type CompanionFolderOperation = {
  folders?: unknown;
  isBranch?: boolean;
  kind: "branch_state" | "folder_created" | "folder_deleted" | "folder_moved" | "folder_renamed" | "reconcile";
  name?: string;
  oldRelativePath?: string;
  operationId: string;
  relativePath?: string;
};

export async function applyCompanionFolderOperation(
  device: { deviceId: string; ownerUserId: string },
  operation: CompanionFolderOperation,
) {
  if (!operation.operationId || operation.operationId.length > 120) throw new Error("invalid_operation");
  const companion = new MongoCompanionRepository();
  const started = await companion.beginOperation(
    device.ownerUserId,
    device.deviceId,
    operation.operationId,
    operation.kind,
  );
  if (!started) return { duplicate: true };
  try {
    const tree = new MongoTreeOfLifeRepository();
    if (operation.kind === "reconcile") {
      const result = await tree.reconcileFolders(device.ownerUserId, operation.folders);
      await companion.completeOperation(device.deviceId, operation.operationId);
      return { duplicate: false, ...result };
    }
    if (!operation.relativePath) throw new Error("invalid_operation");
    if (operation.kind === "branch_state") {
      const matched = await tree.setBranchState(
        device.ownerUserId,
        operation.relativePath,
        operation.isBranch === true,
      );
      if (!matched) throw new Error("folder_not_found");
      await companion.completeOperation(device.deviceId, operation.operationId);
      return { duplicate: false };
    }
    await tree.applyFolderEvent(device.ownerUserId, {
      kind: operation.kind,
      name: operation.name,
      oldRelativePath: operation.oldRelativePath,
      relativePath: operation.relativePath,
    });
    await companion.completeOperation(device.deviceId, operation.operationId);
    return { duplicate: false };
  } catch (error) {
    await companion.abandonOperation(device.deviceId, operation.operationId);
    throw error;
  }
}
