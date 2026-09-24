import { NextResponse } from "next/server";

import { filterRoadmap, roadmapReadTokenIsValid } from "../../../../lib/development/roadmap";
import { loadMachineRoadmap } from "../../../../lib/development/roadmap.server";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!roadmapReadTokenIsValid(
    request.headers.get("authorization"),
    process.env.CARNIVAL_ROADMAP_READ_TOKEN,
  )) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const roadmap = await loadMachineRoadmap();
    if (!roadmap) {
      return NextResponse.json({ error: "roadmap_owner_unavailable" }, { status: 503 });
    }
    const url = new URL(request.url);
    return NextResponse.json(filterRoadmap(roadmap, {
      component: url.searchParams.get("component"),
      priority: url.searchParams.get("priority"),
      q: url.searchParams.get("q"),
      status: url.searchParams.get("status"),
    }), { headers: noStore });
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT ROADMAP_READ_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "roadmap_unavailable" }, { status: 500 });
  }
}
