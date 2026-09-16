import { NextResponse } from "next/server";

import { authenticateCompanionRequest } from "../../../../../../lib/companion/auth";
import { MongoCompanionRepository } from "../../../../../../lib/companion/repository";
import { MongoTreeOfLifeRepository } from "../../../../../../lib/tree-of-life/repository";
import {
  enqueueDriveIdentity,
  processDriveIdentityQueue,
} from "../../../../../../lib/google/drive-auto-reconciliation";

export async function POST(
  request: Request,
  context: { params: Promise<{ commandId: string }> },
) {
  const device = await authenticateCompanionRequest(request);
  if (!device) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { commandId } = await context.params;
  const payload = await request.json() as { error?: string; ok?: boolean; relativePath?: string };
  const repository = new MongoCompanionRepository();
  const command = await repository.getPendingFolderCommand(
    device.deviceId,
    device.ownerUserId,
    commandId,
  );
  if (!command) return NextResponse.json({ ok: true });
  if (payload.ok && payload.relativePath && command.type === "create_folder") {
    await new MongoTreeOfLifeRepository().applyFolderEvent(device.ownerUserId, {
      kind: "folder_created",
      name: command.name,
      relativePath: payload.relativePath,
    });
    if (command.is_branch) {
      await new MongoTreeOfLifeRepository().setBranchState(device.ownerUserId, payload.relativePath, true);
    }
    try {
      await enqueueDriveIdentity(device.ownerUserId, payload.relativePath, command.is_branch);
      await processDriveIdentityQueue(device.ownerUserId);
    } catch (error) {
      console.warn("DRIVE_AUTO_RETRY", {
        reason: error instanceof Error ? error.message : "automatic_drive_reconciliation_failed",
      });
    }
  }
  if (payload.ok && command.type === "set_branch_state" && command.relative_path) {
    await new MongoTreeOfLifeRepository().setBranchState(
      device.ownerUserId,
      command.relative_path,
      command.is_branch,
    );
    if (command.is_branch) {
      try {
        await enqueueDriveIdentity(device.ownerUserId, command.relative_path, true);
        await processDriveIdentityQueue(device.ownerUserId);
      } catch (error) {
        console.warn("DRIVE_AUTO_RETRY", {
          reason: error instanceof Error ? error.message : "automatic_drive_reconciliation_failed",
        });
      }
    }
  }
  await repository.completeFolderCommand(
    device.deviceId,
    device.ownerUserId,
    commandId,
    { error: payload.error, ok: payload.ok === true, relativePath: payload.relativePath },
  );
  return NextResponse.json({ ok: true });
}
