import {
  roadmapAuthorizationServerMetadata,
  roadmapOAuthIssuer,
} from "../../../lib/development/roadmap-oauth.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json(roadmapAuthorizationServerMetadata(roadmapOAuthIssuer(request)), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
