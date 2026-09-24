import { NextResponse } from "next/server";

import { parseDevelopmentFeatureOrder } from "../../../../../domain/development-feature-order";
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
  const featureIds = parseDevelopmentFeatureOrder(body);
  if (!featureIds) return NextResponse.json({ error: "invalid_order" }, { status: 400 });
  try {
    const reordered = await new MongoDevelopmentFeatureRepository()
      .reorderFeatures(ownerUserId, featureIds);
    return reordered
      ? NextResponse.json(
          { reordered: true },
          { headers: { "Cache-Control": "private, no-store" } },
        )
      : NextResponse.json({ error: "feature_set_mismatch" }, { status: 409 });
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT FEATURE_REORDER_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "feature_reorder_failed" }, { status: 500 });
  }
}
