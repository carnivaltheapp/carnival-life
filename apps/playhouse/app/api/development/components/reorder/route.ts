import { NextResponse } from "next/server";

import { parseDevelopmentComponentOrder } from "../../../../../domain/development-component";
import { authenticatedDevelopmentOwner } from "../../../../../lib/development/auth";
import { MongoDevelopmentFeatureRepository } from "../../../../../lib/development/repository";

export async function PATCH(request: Request) {
  const ownerUserId = await authenticatedDevelopmentOwner();
  if (!ownerUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const componentIds = parseDevelopmentComponentOrder(body);
  if (!componentIds) return NextResponse.json({ error: "invalid_order" }, { status: 400 });
  try {
    const reordered = await new MongoDevelopmentFeatureRepository()
      .reorderComponents(ownerUserId, componentIds);
    return reordered
      ? NextResponse.json({ reordered: true }, { headers: { "Cache-Control": "private, no-store" } })
      : NextResponse.json({ error: "component_set_mismatch" }, { status: 409 });
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT COMPONENT_REORDER_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "component_reorder_failed" }, { status: 500 });
  }
}
