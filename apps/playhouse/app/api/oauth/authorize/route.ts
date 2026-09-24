import { NextResponse } from "next/server";

import { authenticatedDevelopmentOwner } from "../../../../lib/development/auth";
import {
  authorizationRedirect,
  CarnivalRoadmapOAuthService,
  RoadmapOAuthError,
  roadmapOAuthIssuer,
} from "../../../../lib/development/roadmap-oauth.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const issuer = roadmapOAuthIssuer(request);
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 16_384) {
      throw new RoadmapOAuthError("invalid_request", "Authorization request is too large.");
    }
    if (request.headers.get("origin") !== issuer) {
      throw new RoadmapOAuthError("invalid_request", "Authorization origin is invalid.", 403);
    }
    const form = await request.formData();
    const parameters = new URLSearchParams();
    for (const key of [
      "client_id",
      "code_challenge",
      "code_challenge_method",
      "redirect_uri",
      "resource",
      "response_type",
      "scope",
      "state",
    ]) {
      const value = form.get(key);
      if (typeof value === "string") parameters.set(key, value);
    }
    const oauth = new CarnivalRoadmapOAuthService();
    const authorization = await oauth.validateAuthorizationRequest(issuer, parameters);
    if (form.get("decision") === "deny") {
      return NextResponse.redirect(authorizationRedirect(issuer, authorization, {
        error: "access_denied",
      }));
    }
    if (form.get("decision") !== "allow") {
      throw new RoadmapOAuthError("invalid_request", "Authorization decision is invalid.");
    }
    const ownerUserId = await authenticatedDevelopmentOwner();
    if (!ownerUserId) {
      throw new RoadmapOAuthError("access_denied", "Carnival sign-in is required.", 401);
    }
    const code = await oauth.issueAuthorizationCode(issuer, ownerUserId, authorization);
    return NextResponse.redirect(authorizationRedirect(issuer, authorization, { code }));
  } catch (error) {
    const oauthError = error instanceof RoadmapOAuthError
      ? error
      : new RoadmapOAuthError("server_error", "Authorization could not be completed.", 500);
    return Response.json(
      { error: oauthError.code, error_description: oauthError.message },
      { headers: { "Cache-Control": "no-store" }, status: oauthError.status },
    );
  }
}
