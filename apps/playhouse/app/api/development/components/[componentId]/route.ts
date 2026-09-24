import { NextResponse } from "next/server";

import { parseDevelopmentComponentInput } from "../../../../../domain/development-component";
import { isDevelopmentFeatureId } from "../../../../../domain/development-feature";
import { authenticatedDevelopmentOwner } from "../../../../../lib/development/auth";
import { MongoDevelopmentFeatureRepository } from "../../../../../lib/development/repository";

const noStore = { "Cache-Control": "private, no-store" };

async function context(params: Promise<{ componentId: string }>) {
  const [{ componentId }, ownerUserId] = await Promise.all([params, authenticatedDevelopmentOwner()]);
  return { componentId, ownerUserId };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ componentId: string }> },
) {
  const { componentId, ownerUserId } = await context(params);
  if (!ownerUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isDevelopmentFeatureId(componentId)) {
    return NextResponse.json({ error: "invalid_component_id" }, { status: 400 });
  }
  const repository = new MongoDevelopmentFeatureRepository();
  const component = await repository.getComponent(ownerUserId, componentId);
  if (!component) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    component,
    featureCount: await repository.componentFeatureCount(ownerUserId, componentId),
  }, { headers: noStore });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ componentId: string }> },
) {
  const { componentId, ownerUserId } = await context(params);
  if (!ownerUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isDevelopmentFeatureId(componentId)) {
    return NextResponse.json({ error: "invalid_component_id" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = parseDevelopmentComponentInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid_component", message: parsed.error }, { status: 400 });
  }
  try {
    const component = await new MongoDevelopmentFeatureRepository()
      .updateComponent(ownerUserId, componentId, parsed.input);
    return component
      ? NextResponse.json({ component }, { headers: noStore })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      return NextResponse.json(
        { error: "component_name_exists", message: "A component with that name already exists." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "component_update_failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ componentId: string }> },
) {
  const { componentId, ownerUserId } = await context(params);
  if (!ownerUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isDevelopmentFeatureId(componentId)) {
    return NextResponse.json({ error: "invalid_component_id" }, { status: 400 });
  }
  let moveToComponentId: string | undefined;
  try {
    const body = await request.json() as { moveToComponentId?: unknown };
    if (body.moveToComponentId !== undefined) {
      if (typeof body.moveToComponentId !== "string" || !isDevelopmentFeatureId(body.moveToComponentId)) {
        return NextResponse.json({ error: "invalid_destination" }, { status: 400 });
      }
      moveToComponentId = body.moveToComponentId;
    }
  } catch {
    // An empty DELETE body is valid for an unused component.
  }
  try {
    const result = await new MongoDevelopmentFeatureRepository()
      .deleteComponent(ownerUserId, componentId, moveToComponentId);
    if (result.deleted) return NextResponse.json(result, { headers: noStore });
    if (result.reason === "component_in_use") {
      return NextResponse.json(result, { status: 409 });
    }
    if (result.reason === "destination_not_found") {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result, { status: 404 });
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT COMPONENT_DELETE_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "component_delete_failed" }, { status: 500 });
  }
}
