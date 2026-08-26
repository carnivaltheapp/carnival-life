import { NextResponse, type NextRequest } from "next/server";

import { getSafeNextPath } from "../../../lib/auth/redirect";
import { upsertGoogleAccountAfterSignIn } from "../../../lib/google/account";
import { retainGoogleRefreshToken } from "../../../lib/google/token-broker.server";
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
    const { data, error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );

    if (error || !data.session) {
      return authErrorRedirect(request);
    }

    const googleAccountId = await upsertGoogleAccountAfterSignIn({
      session: data.session,
      supabase,
    });

    if (googleAccountId) {
      try {
        await retainGoogleRefreshToken({
          googleAccountId,
          ownerUserId: data.session.user.id,
          providerRefreshToken: data.session.provider_refresh_token,
        });
      } catch {
        await supabase.auth.signOut();
        return authErrorRedirect(request);
      }
    } else if (
      data.session.provider_token ||
      data.session.provider_refresh_token
    ) {
      await supabase.auth.signOut();
      return authErrorRedirect(request);
    }

    if (data.session.provider_token || data.session.provider_refresh_token) {
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessionError) {
        await supabase.auth.signOut();
        return authErrorRedirect(request);
      }
    }

    return NextResponse.redirect(new URL(next, getTrustedOrigin(request)));
  } catch {
    return authErrorRedirect(request);
  }
}
