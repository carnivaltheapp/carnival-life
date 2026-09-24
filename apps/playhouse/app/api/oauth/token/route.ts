import {
  CarnivalRoadmapOAuthService,
  RoadmapOAuthError,
  roadmapOAuthIssuer,
} from "../../../../lib/development/roadmap-oauth.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 16_384) {
      throw new RoadmapOAuthError("invalid_request", "OAuth token request is too large.");
    }
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
      throw new RoadmapOAuthError("invalid_request", "Form-encoded token request required.");
    }
    if (request.headers.has("authorization")) {
      throw new RoadmapOAuthError("invalid_client", "Public-client token exchange is required.", 401);
    }
    const token = await new CarnivalRoadmapOAuthService().exchangeAuthorizationCode(
      roadmapOAuthIssuer(request),
      new URLSearchParams(await request.text()),
    );
    return Response.json(token, {
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    const oauthError = error instanceof RoadmapOAuthError
      ? error
      : new RoadmapOAuthError("invalid_grant", "OAuth token exchange failed.");
    return Response.json(
      { error: oauthError.code, error_description: oauthError.message },
      {
        headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
        status: oauthError.status,
      },
    );
  }
}
