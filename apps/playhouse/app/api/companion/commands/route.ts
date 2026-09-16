import { NextResponse } from "next/server";

import { authenticateCompanionRequest } from "../../../../lib/companion/auth";
import { MongoCompanionRepository } from "../../../../lib/companion/repository";
import { processDriveIdentityQueue } from "../../../../lib/google/drive-auto-reconciliation";

export async function GET(request: Request) {
  const device = await authenticateCompanionRequest(request);
  if (!device) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    await processDriveIdentityQueue(device.ownerUserId, { limit: 1 });
  } catch (error) {
    console.warn("DRIVE_AUTO_RETRY", {
      reason: error instanceof Error ? error.message : "automatic_drive_reconciliation_failed",
    });
  }
  const commands = await new MongoCompanionRepository().pendingFolderCommands(
    device.deviceId,
    device.ownerUserId,
  );
  return NextResponse.json({ commands });
}
