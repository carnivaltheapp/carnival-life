import { roadmapMcpResourceMetadata } from "../../../../../../lib/development/mcp-auth.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json(roadmapMcpResourceMetadata(request), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
