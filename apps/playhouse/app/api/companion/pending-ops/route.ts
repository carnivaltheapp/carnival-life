import { NextResponse } from "next/server";

import { authenticateCompanionRequest } from "../../../../lib/companion/auth";
import { applyCompanionFolderOperation, type CompanionFolderOperation } from "../../../../lib/companion/operations";

export async function POST(request: Request) {
  const device = await authenticateCompanionRequest(request);
  if (!device) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const payload = await request.json() as { operations?: CompanionFolderOperation[] };
    if (!Array.isArray(payload.operations) || payload.operations.length > 100) throw new Error("invalid_operations");
    const results = [];
    for (const operation of payload.operations) {
      results.push(await applyCompanionFolderOperation(device, operation));
    }
    return NextResponse.json({ ok: true, results });
  } catch {
    return NextResponse.json({ error: "invalid_operations", ok: false }, { status: 400 });
  }
}
