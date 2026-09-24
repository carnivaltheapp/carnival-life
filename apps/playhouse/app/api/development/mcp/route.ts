import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import {
  authenticateRoadmapMcpRequest,
  roadmapMcpAuthenticationChallenge,
  roadmapMcpToolAuthenticationChallenge,
} from "../../../../lib/development/mcp-auth.server";
import { createRoadmapMcpServer } from "../../../../lib/development/mcp.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function includeToolSecuritySchemes(message: JSONRPCMessage): JSONRPCMessage {
  if (!("result" in message) || typeof message.result !== "object" || message.result === null) {
    return message;
  }
  const result = message.result as Record<string, unknown>;
  if (!Array.isArray(result.tools)) return message;
  return {
    ...message,
    result: {
      ...result,
      tools: result.tools.map((tool) => {
        if (typeof tool !== "object" || tool === null) return tool;
        const descriptor = tool as Record<string, unknown>;
        const metadata = typeof descriptor._meta === "object" && descriptor._meta !== null
          ? descriptor._meta as Record<string, unknown>
          : null;
        return metadata?.securitySchemes
          ? { ...descriptor, securitySchemes: metadata.securitySchemes }
          : descriptor;
      }),
    },
  } as JSONRPCMessage;
}

async function handle(request: Request) {
  const identity = await authenticateRoadmapMcpRequest(request);
  if (!identity && (request.headers.has("authorization") || request.method !== "POST")) {
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
  const send = transport.send.bind(transport);
  transport.send = (message, options) => send(includeToolSecuritySchemes(message), options);
  const server = createRoadmapMcpServer(identity
    ? { ownerUserId: identity.ownerUserId }
    : { authenticationChallenge: roadmapMcpToolAuthenticationChallenge(request) });
  await server.connect(transport);
  return transport.handleRequest(request, {
    authInfo: {
      clientId: identity?.source ?? "unauthenticated",
      scopes: identity?.scopes ?? [],
      token: "validated",
    },
  });
}

export const DELETE = handle;
export const GET = handle;
export const POST = handle;
