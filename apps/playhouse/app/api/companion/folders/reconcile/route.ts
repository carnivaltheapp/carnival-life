import { NextResponse } from "next/server";

import { authenticateCompanionRequest } from "../../../../../lib/companion/auth";
import { applyCompanionFolderOperation } from "../../../../../lib/companion/operations";

export async function POST(request: Request) {
  const device = await authenticateCompanionRequest(request);
  if (!device) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const payload = await request.json() as { folders?: unknown; operationId?: string };
    const result = await applyCompanionFolderOperation(device, {
      folders: payload.folders,
      kind: "reconcile",
      operationId: payload.operationId ?? "",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "invalid_folder_image", ok: false }, { status: 400 });
  }
}
