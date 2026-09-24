import { NextResponse } from "next/server";

import {
  isDevelopmentFeatureId,
  parseDevelopmentFeatureInput,
} from "../../../../../domain/development-feature";
import { authenticatedDevelopmentOwner } from "../../../../../lib/development/auth";
import { MongoDevelopmentFeatureRepository } from "../../../../../lib/development/repository";

const noStore = { "Cache-Control": "private, no-store" };

async function requestContext(params: Promise<{ featureId: string }>) {
  const [{ featureId }, ownerUserId] = await Promise.all([
    params,
    authenticatedDevelopmentOwner(),
  ]);
  return { featureId, ownerUserId };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ featureId: string }> },
) {
  const { featureId, ownerUserId } = await requestContext(params);
  if (!ownerUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isDevelopmentFeatureId(featureId)) {
    return NextResponse.json({ error: "invalid_feature_id" }, { status: 400 });
  }
  try {
    const feature = await new MongoDevelopmentFeatureRepository().get(ownerUserId, featureId);
    return feature
      ? NextResponse.json({ feature }, { headers: noStore })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT FEATURE_GET_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "feature_unavailable" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ featureId: string }> },
) {
  const { featureId, ownerUserId } = await requestContext(params);
  if (!ownerUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isDevelopmentFeatureId(featureId)) {
    return NextResponse.json({ error: "invalid_feature_id" }, { status: 400 });
  }
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
    if (!await repository.dependenciesExist(ownerUserId, parsed.input.dependencies, featureId)) {
      return NextResponse.json(
        { error: "invalid_dependencies", message: "Choose other existing features as dependencies." },
        { status: 400 },
      );
    }
    const feature = await repository.update(ownerUserId, featureId, parsed.input);
    return feature
      ? NextResponse.json({ feature }, { headers: noStore })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT FEATURE_UPDATE_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "feature_update_failed" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ featureId: string }> },
) {
  const { featureId, ownerUserId } = await requestContext(params);
  if (!ownerUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isDevelopmentFeatureId(featureId)) {
    return NextResponse.json({ error: "invalid_feature_id" }, { status: 400 });
  }
  try {
    const deleted = await new MongoDevelopmentFeatureRepository().delete(ownerUserId, featureId);
    return deleted
      ? NextResponse.json({ deleted: true }, { headers: noStore })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT FEATURE_DELETE_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "feature_delete_failed" }, { status: 500 });
  }
}
