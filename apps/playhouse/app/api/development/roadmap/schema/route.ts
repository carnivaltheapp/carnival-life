import { NextResponse } from "next/server";

import { ROADMAP_SCHEMA, roadmapReadTokenIsValid } from "../../../../../lib/development/roadmap";

export async function GET(request: Request) {
  if (!roadmapReadTokenIsValid(
    request.headers.get("authorization"),
    process.env.CARNIVAL_ROADMAP_READ_TOKEN,
  )) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(ROADMAP_SCHEMA, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
