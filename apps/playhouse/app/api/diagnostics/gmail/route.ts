import { NextResponse, type NextRequest } from "next/server";

import {
  GMAIL_DIAGNOSTIC_STAGES,
  MongoGmailDiagnosticRepository,
  recordGmailDiagnostic,
  type GmailDiagnosticStage,
} from "../../../../lib/incoming-events/gmail-diagnostics";
import { resolvePlayhouseDataSource } from "../../../../lib/playhouse/data-source";
import { createClient } from "../../../../lib/supabase/server";

const LIST_ROW_STAGES = [
  "LIST_ROW_POINTERDOWN",
  "LIST_ROW_METADATA_RESOLVED",
  "LIST_ROW_DRAGSTART",
] as const;
const LIST_ROW_REASONS = [
  "recognized",
  "row_not_recognized",
  "metadata_container_missing",
  "web_thread_missing",
  "api_thread_missing",
  "draggable_target_missing",
  "metadata_resolution_failed",
  "dragstart_not_fired",
  "metadata_not_ready",
  "completed",
] as const;
const LIST_ROW_ROLES = [
  "button", "checkbox", "gridcell", "link", "main", "none", "other", "presentation", "row",
] as const;

function booleanValue(input: Record<string, unknown>, key: string) {
  return typeof input[key] === "boolean" ? input[key] as boolean : undefined;
}

async function authenticatedOwnerUserId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const ownerUserId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  return !error && ownerUserId && resolvePlayhouseDataSource() === "mongo"
    ? ownerUserId
    : null;
}

export async function GET(request: NextRequest) {
  const ownerUserId = await authenticatedOwnerUserId();
  if (!ownerUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const playId = request.nextUrl.searchParams.get("playId");
  const reason = request.nextUrl.searchParams.get("reason");
  const requestedStage = request.nextUrl.searchParams.get("stage");
  const stage = requestedStage && GMAIL_DIAGNOSTIC_STAGES.includes(
    requestedStage as GmailDiagnosticStage,
  ) ? requestedStage as GmailDiagnosticStage : null;
  const threadFingerprint = request.nextUrl.searchParams.get("threadFingerprint");
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "100");
  if (
    (playId && playId.length > 100) ||
    (reason && reason.length > 100) ||
    (requestedStage && !stage) ||
    (threadFingerprint && !/^[a-f0-9]{64}$/.test(threadFingerprint)) ||
    !Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500
  ) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const diagnostics = await new MongoGmailDiagnosticRepository().list({
    limit: requestedLimit,
    ownerUserId,
    playId,
    reason,
    stage,
    threadFingerprint,
  });
  return NextResponse.json(
    { diagnostics },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const ownerUserId = await authenticatedOwnerUserId();
  if (!ownerUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let input: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    input = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_diagnostic" }, { status: 400 });
  }
  const stage = typeof input.stage === "string" && LIST_ROW_STAGES.includes(
    input.stage as (typeof LIST_ROW_STAGES)[number],
  ) ? input.stage as (typeof LIST_ROW_STAGES)[number] : null;
  const reason = typeof input.reason === "string" && LIST_ROW_REASONS.includes(
    input.reason as (typeof LIST_ROW_REASONS)[number],
  ) ? input.reason : null;
  const correlationId = typeof input.correlationId === "string" &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(input.correlationId)
    ? input.correlationId
    : null;
  if (!stage || !reason || !correlationId) {
    return NextResponse.json({ error: "invalid_diagnostic" }, { status: 400 });
  }

  const ancestorTags = Array.isArray(input.ancestorTags) && input.ancestorTags.every((tag) => (
    typeof tag === "string" && /^[A-Z][A-Z0-9-]{0,19}$/.test(tag)
  )) && input.ancestorTags.length <= 7 ? input.ancestorTags as string[] : undefined;
  const ancestorRoles = Array.isArray(input.ancestorRoles) && input.ancestorRoles.every((role) => (
    typeof role === "string" && LIST_ROW_ROLES.includes(
      role as (typeof LIST_ROW_ROLES)[number],
    )
  )) && input.ancestorRoles.length <= 7 ? input.ancestorRoles as string[] : undefined;
  const targetTag = typeof input.targetTag === "string" &&
    /^[A-Z][A-Z0-9-]{0,19}$/.test(input.targetTag) ? input.targetTag : undefined;
  const targetRole = typeof input.targetRole === "string" && LIST_ROW_ROLES.includes(
    input.targetRole as (typeof LIST_ROW_ROLES)[number],
  ) ? input.targetRole : undefined;
  const persisted = await recordGmailDiagnostic({
    ancestorDepth: Number.isSafeInteger(input.ancestorDepth) && Number(input.ancestorDepth) >= 0 &&
      Number(input.ancestorDepth) <= 6 ? Number(input.ancestorDepth) : undefined,
    ancestorRoles,
    ancestorTags,
    apiThreadPresent: booleanValue(input, "apiThreadPresent"),
    clickableMessageLinkPresent: booleanValue(input, "clickableMessageLinkPresent"),
    correlationId,
    dataLegacyThreadAttributePresent: booleanValue(input, "dataLegacyThreadAttributePresent"),
    dataMessageAttributePresent: booleanValue(input, "dataMessageAttributePresent"),
    dataThreadAttributePresent: booleanValue(input, "dataThreadAttributePresent"),
    draggableAncestorPresent: booleanValue(input, "draggableAncestorPresent"),
    draggableAttributePresent: booleanValue(input, "draggableAttributePresent"),
    draggableTargetPresent: booleanValue(input, "draggableTargetPresent"),
    fired: booleanValue(input, "fired"),
    handlerReached: booleanValue(input, "handlerReached"),
    metadataReady: booleanValue(input, "metadataReady"),
    ownerUserId,
    reason,
    rolePresent: booleanValue(input, "rolePresent"),
    rowRecognized: booleanValue(input, "rowRecognized"),
    source: "list_row",
    stage,
    success: booleanValue(input, "success"),
    targetRole,
    targetTag,
    webThreadPresent: booleanValue(input, "webThreadPresent"),
  });
  return persisted
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "diagnostic_unavailable" }, { status: 503 });
}
