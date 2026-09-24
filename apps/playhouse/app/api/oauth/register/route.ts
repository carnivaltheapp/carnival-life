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
      throw new RoadmapOAuthError("invalid_client_metadata", "OAuth client metadata is too large.");
    }
    const client = await new CarnivalRoadmapOAuthService().registerClient(
      roadmapOAuthIssuer(request),
      await request.json(),
    );
    return Response.json(client, {
      headers: { "Cache-Control": "no-store" },
      status: 201,
    });
  } catch (error) {
    const oauthError = error instanceof RoadmapOAuthError
      ? error
      : new RoadmapOAuthError("invalid_client_metadata", "OAuth client registration failed.");
    return Response.json(
      { error: oauthError.code, error_description: oauthError.message },
      { headers: { "Cache-Control": "no-store" }, status: oauthError.status },
    );
  }
}
