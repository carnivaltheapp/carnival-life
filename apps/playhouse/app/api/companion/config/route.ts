import { NextResponse } from "next/server";

import { authenticateCompanionRequest } from "../../../../lib/companion/auth";

export async function GET(request: Request) {
  const device = await authenticateCompanionRequest(request);
  if (!device) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    deviceId: device.deviceId,
    folderRoot: "C:\\Google Drive",
    pollIntervalSeconds: 5,
  }, { headers: { "Cache-Control": "no-store" } });
}
