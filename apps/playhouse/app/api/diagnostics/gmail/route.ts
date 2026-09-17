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

  await recordGmailDiagnostic({
    apiThreadPresent: typeof input.apiThreadPresent === "boolean"
      ? input.apiThreadPresent
      : undefined,
    correlationId,
    draggableTargetPresent: typeof input.draggableTargetPresent === "boolean"
      ? input.draggableTargetPresent
      : undefined,
    fired: typeof input.fired === "boolean" ? input.fired : undefined,
    metadataReady: typeof input.metadataReady === "boolean" ? input.metadataReady : undefined,
    ownerUserId,
    reason,
    rowRecognized: typeof input.rowRecognized === "boolean" ? input.rowRecognized : undefined,
    source: "list_row",
    stage,
    success: typeof input.success === "boolean" ? input.success : undefined,
    webThreadPresent: typeof input.webThreadPresent === "boolean"
      ? input.webThreadPresent
      : undefined,
  });
  return new NextResponse(null, { status: 204 });
}
