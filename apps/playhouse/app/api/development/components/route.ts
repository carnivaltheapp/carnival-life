import { NextResponse } from "next/server";

import { parseDevelopmentComponentInput } from "../../../../domain/development-component";
import { authenticatedDevelopmentOwner } from "../../../../lib/development/auth";
import { MongoDevelopmentFeatureRepository } from "../../../../lib/development/repository";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  const ownerUserId = await authenticatedDevelopmentOwner();
  if (!ownerUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const repository = new MongoDevelopmentFeatureRepository();
    await repository.ensureComponentSeed(ownerUserId);
    return NextResponse.json(
      { components: await repository.listComponents(ownerUserId) },
      { headers: noStore },
    );
  } catch (error) {
    console.error("CARNIVAL_DEVELOPMENT COMPONENT_LIST_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "components_unavailable" }, { status: 500 });
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
  const parsed = parseDevelopmentComponentInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid_component", message: parsed.error }, { status: 400 });
  }
  try {
    const component = await new MongoDevelopmentFeatureRepository()
      .createComponent(ownerUserId, parsed.input);
    return NextResponse.json({ component }, { headers: noStore, status: 201 });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      return NextResponse.json(
        { error: "component_name_exists", message: "A component with that name already exists." },
        { status: 409 },
      );
    }
    console.error("CARNIVAL_DEVELOPMENT COMPONENT_CREATE_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "component_create_failed" }, { status: 500 });
  }
}
