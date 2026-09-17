import { NextResponse, type NextRequest } from "next/server";

import {
  GMAIL_DIAGNOSTIC_STAGES,
  MongoGmailDiagnosticRepository,
  type GmailDiagnosticStage,
} from "../../../../lib/incoming-events/gmail-diagnostics";
import { resolvePlayhouseDataSource } from "../../../../lib/playhouse/data-source";
import { createClient } from "../../../../lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const ownerUserId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (error || !ownerUserId || resolvePlayhouseDataSource() !== "mongo") {
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
