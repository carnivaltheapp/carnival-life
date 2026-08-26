import { NextResponse, type NextRequest } from "next/server";

import { getSafeNextPath } from "../../../lib/auth/redirect";
import { createClient } from "../../../lib/supabase/server";

const PRODUCTION_ORIGIN = "https://carnival-playhouse.vercel.app";

function getTrustedOrigin(request: NextRequest) {
  if (
    process.env.NODE_ENV === "development" &&
    (request.nextUrl.hostname === "localhost" || request.nextUrl.hostname === "127.0.0.1") &&
    request.nextUrl.port === "3002"
  ) {
    return request.nextUrl.origin;
  }

  return PRODUCTION_ORIGIN;
}

function authErrorRedirect(request: NextRequest) {
  const destination = new URL("/", getTrustedOrigin(request));
  destination.searchParams.set("authError", "callback");
  return NextResponse.redirect(destination);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const flowId = request.nextUrl.searchParams.get("sb_flow_id");
  const next = getSafeNextPath(request.nextUrl.searchParams.get("next"));

  if (!code) {
    return authErrorRedirect(request);
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );

    if (error) {
      return authErrorRedirect(request);
    }

    return NextResponse.redirect(new URL(next, getTrustedOrigin(request)));
  } catch {
    return authErrorRedirect(request);
  }
}
