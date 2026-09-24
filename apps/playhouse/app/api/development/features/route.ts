import { NextResponse } from "next/server";

import { parseDevelopmentFeatureInput } from "../../../../domain/development-feature";
import { authenticatedDevelopmentOwner } from "../../../../lib/development/auth";
import { MongoDevelopmentFeatureRepository } from "../../../../lib/development/repository";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  const ownerUserId = await authenticatedDevelopmentOwner();
  if (!ownerUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const repository = new MongoDevelopmentFeatureRepository();
    await repository.ensureDemoSeed(ownerUserId);
    return NextResponse.json(
      { features: await repository.list(ownerUserId) },
      { headers: noStore },
    );
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT FEATURE_LIST_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "features_unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ownerUserId = await authenticatedDevelopmentOwner();
  if (!ownerUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = parseDevelopmentFeatureInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid_feature", message: parsed.error }, { status: 400 });
  }
  try {
    const repository = new MongoDevelopmentFeatureRepository();
    if (!await repository.dependenciesExist(ownerUserId, parsed.input.dependencies)) {
      return NextResponse.json(
        { error: "invalid_dependencies", message: "Choose existing feature dependencies." },
        { status: 400 },
      );
    }
    const feature = await repository.create(ownerUserId, parsed.input);
    return NextResponse.json({ feature }, { headers: noStore, status: 201 });
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT FEATURE_CREATE_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "feature_create_failed" }, { status: 500 });
  }
}
