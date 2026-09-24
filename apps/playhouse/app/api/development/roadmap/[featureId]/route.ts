import { NextResponse } from "next/server";

import {
  roadmapFeatureByReference,
  roadmapReadTokenIsValid,
} from "../../../../../lib/development/roadmap";
import { loadMachineRoadmap } from "../../../../../lib/development/roadmap.server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ featureId: string }> },
) {
  if (!roadmapReadTokenIsValid(
    request.headers.get("authorization"),
    process.env.CARNIVAL_ROADMAP_READ_TOKEN,
  )) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const roadmap = await loadMachineRoadmap();
    if (!roadmap) return NextResponse.json({ error: "roadmap_owner_unavailable" }, { status: 503 });
    const feature = roadmapFeatureByReference(roadmap, (await params).featureId);
    return feature
      ? NextResponse.json({ feature }, { headers: { "Cache-Control": "private, no-store" } })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT ROADMAP_FEATURE_READ_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "roadmap_unavailable" }, { status: 500 });
  }
}
