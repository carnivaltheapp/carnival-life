import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import {
  authenticateRoadmapMcpRequest,
  roadmapMcpAuthenticationChallenge,
} from "../../../../lib/development/mcp-auth.server";
import { createRoadmapMcpServer } from "../../../../lib/development/mcp.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: Request) {
  const identity = await authenticateRoadmapMcpRequest(request);
  if (!identity) {
    return Response.json(
      { error: "unauthorized" },
      {
        headers: { "WWW-Authenticate": roadmapMcpAuthenticationChallenge(request) },
        status: 401,
      },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  const server = createRoadmapMcpServer(identity.ownerUserId);
  await server.connect(transport);
  return transport.handleRequest(request, {
    authInfo: {
      clientId: identity.source,
      scopes: identity.scopes,
      token: "validated",
    },
  });
}

export const DELETE = handle;
export const GET = handle;
export const POST = handle;
