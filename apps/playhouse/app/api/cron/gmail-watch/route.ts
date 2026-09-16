import { NextResponse, type NextRequest } from "next/server";

import { renewConnectedGmailWatches } from "../../../../lib/incoming-events/gmail-watch.server";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await renewConnectedGmailWatches();
    console.info("CARNIVAL_INCOMING_EVENT GMAIL_WATCH_RENEWAL_COMPLETE", result);
    return NextResponse.json(result);
  } catch (error) {
    console.error("CARNIVAL_INCOMING_EVENT GMAIL_WATCH_RENEWAL_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "renewal_failed" }, { status: 500 });
  }
}
