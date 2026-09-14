import { NextResponse } from "next/server";

import { authenticateCompanionRequest } from "../../../../lib/companion/auth";
import { applyCompanionFolderOperation, type CompanionFolderOperation } from "../../../../lib/companion/operations";

export async function POST(request: Request) {
  const device = await authenticateCompanionRequest(request);
  if (!device) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const operation = await request.json() as CompanionFolderOperation;
    if (operation.kind !== "branch_state") throw new Error("invalid_kind");
    const result = await applyCompanionFolderOperation(device, operation);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid_branch_state";
    return NextResponse.json({ error: reason, ok: false }, { status: 400 });
  }
}
