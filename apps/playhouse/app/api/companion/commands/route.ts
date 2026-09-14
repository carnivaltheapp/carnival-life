import { NextResponse } from "next/server";

import { authenticateCompanionRequest } from "../../../../lib/companion/auth";
import { MongoCompanionRepository } from "../../../../lib/companion/repository";

export async function GET(request: Request) {
  const device = await authenticateCompanionRequest(request);
  if (!device) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const commands = await new MongoCompanionRepository().pendingFolderCommands(
    device.deviceId,
    device.ownerUserId,
  );
  return NextResponse.json({ commands });
}
