import { NextResponse } from "next/server";

import { isDevelopmentFeatureId } from "../../../../../../domain/development-feature";
import { authenticatedDevelopmentOwner } from "../../../../../../lib/development/auth";
import { MongoDevelopmentFeatureRepository } from "../../../../../../lib/development/repository";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ featureId: string }> },
) {
  const [{ featureId }, ownerUserId] = await Promise.all([
    params,
    authenticatedDevelopmentOwner(),
  ]);
  if (!ownerUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isDevelopmentFeatureId(featureId)) {
    return NextResponse.json({ error: "invalid_feature_id" }, { status: 400 });
  }
  let componentId: unknown;
  try {
    ({ componentId } = await request.json() as { componentId?: unknown });
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof componentId !== "string" || !isDevelopmentFeatureId(componentId)) {
    return NextResponse.json({ error: "invalid_component_id" }, { status: 400 });
  }
  try {
    const feature = await new MongoDevelopmentFeatureRepository()
      .moveFeatureToComponent(ownerUserId, featureId, componentId);
    return feature
      ? NextResponse.json(
          { feature },
          { headers: { "Cache-Control": "private, no-store" } },
        )
      : NextResponse.json({ error: "feature_or_component_not_found" }, { status: 404 });
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT FEATURE_COMPONENT_MOVE_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "feature_component_move_failed" }, { status: 500 });
  }
}
