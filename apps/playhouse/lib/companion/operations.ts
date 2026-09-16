import "server-only";

import { MongoCompanionRepository } from "./repository";
import { MongoTreeOfLifeRepository } from "../tree-of-life/repository";
import {
  cancelDriveIdentityPrefix,
  enqueueDriveIdentity,
  enqueueUnresolvedDriveBranches,
  processDriveIdentityQueue,
  retargetDriveIdentityPrefix,
} from "../google/drive-auto-reconciliation";

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
      await bestEffortDriveReconciliation(async () => {
        await enqueueUnresolvedDriveBranches(device.ownerUserId);
        await processDriveIdentityQueue(device.ownerUserId);
      });
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
      if (operation.isBranch) {
        await bestEffortDriveReconciliation(async () => {
          await enqueueDriveIdentity(device.ownerUserId, operation.relativePath!, true);
          await processDriveIdentityQueue(device.ownerUserId);
        });
      }
      await companion.completeOperation(device.deviceId, operation.operationId);
      return { duplicate: false };
    }
    await tree.applyFolderEvent(device.ownerUserId, {
      kind: operation.kind,
      name: operation.name,
      oldRelativePath: operation.oldRelativePath,
      relativePath: operation.relativePath,
    });
    await bestEffortDriveReconciliation(async () => {
      if (operation.kind === "folder_deleted") {
        await cancelDriveIdentityPrefix(device.ownerUserId, operation.relativePath!);
      } else {
        if (
          (operation.kind === "folder_moved" || operation.kind === "folder_renamed") &&
          operation.oldRelativePath
        ) {
          await retargetDriveIdentityPrefix(
            device.ownerUserId,
            operation.oldRelativePath,
            operation.relativePath!,
          );
        }
        await enqueueDriveIdentity(device.ownerUserId, operation.relativePath!, false);
        await processDriveIdentityQueue(device.ownerUserId);
      }
    });
    await companion.completeOperation(device.deviceId, operation.operationId);
    return { duplicate: false };
  } catch (error) {
    await companion.abandonOperation(device.deviceId, operation.operationId);
    throw error;
  }
}

async function bestEffortDriveReconciliation(operation: () => Promise<void>) {
  try {
    await operation();
  } catch (error) {
    console.warn("DRIVE_AUTO_RETRY", {
      reason: error instanceof Error ? error.message : "automatic_drive_reconciliation_failed",
    });
  }
}
