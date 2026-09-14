import { NextResponse } from "next/server";

import { authenticateCompanionRequest } from "../../../../../../lib/companion/auth";
import { MongoCompanionRepository } from "../../../../../../lib/companion/repository";
import { MongoTreeOfLifeRepository } from "../../../../../../lib/tree-of-life/repository";

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
  if (payload.ok && payload.relativePath) {
    await new MongoTreeOfLifeRepository().applyFolderEvent(device.ownerUserId, {
      kind: "folder_created",
      name: command.name,
      relativePath: payload.relativePath,
    });
    if (command.is_branch) {
      await new MongoTreeOfLifeRepository().setBranchState(device.ownerUserId, payload.relativePath, true);
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
