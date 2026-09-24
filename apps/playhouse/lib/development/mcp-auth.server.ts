import "server-only";

import { MongoDevelopmentFeatureRepository } from "./repository";
import { roadmapReadTokenIsValid } from "./roadmap";
import {
  CarnivalRoadmapOAuthService,
  ROADMAP_SCOPE,
  ROADMAP_SCOPES,
  roadmapMcpResource,
  roadmapOAuthIssuer,
} from "./roadmap-oauth.server";

export type RoadmapMcpIdentity = {
  ownerUserId: string;
  source: "oauth" | "roadmap-token";
  scopes: string[];
};

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1] ?? null;
}

export async function authenticateRoadmapMcpRequest(
  request: Request,
  oauth: Pick<CarnivalRoadmapOAuthService, "authenticateAccessToken"> =
    new CarnivalRoadmapOAuthService(),
): Promise<RoadmapMcpIdentity | null> {
  const token = bearerToken(request);
  if (!token) return null;

  if (roadmapReadTokenIsValid(`Bearer ${token}`, process.env.CARNIVAL_ROADMAP_READ_TOKEN)) {
    const ownerUserId = await new MongoDevelopmentFeatureRepository().machineRoadmapOwner();
    return ownerUserId
      ? { ownerUserId, scopes: [ROADMAP_SCOPE], source: "roadmap-token" }
      : null;
  }

  const authenticated = await oauth.authenticateAccessToken(roadmapOAuthIssuer(request), token);
  return authenticated
    ? { ...authenticated, source: "oauth" }
    : null;
}

export function roadmapMcpResourceMetadata(request: Request) {
  const issuer = roadmapOAuthIssuer(request);
  return {
    authorization_servers: [issuer],
    resource: roadmapMcpResource(issuer),
    resource_documentation: `${issuer}/development`,
    scopes_supported: [...ROADMAP_SCOPES],
  };
}

export function roadmapMcpAuthenticationChallenge(request: Request) {
  const origin = new URL(request.url).origin;
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource/api/development/mcp`;
  return `Bearer resource_metadata="${metadataUrl}", scope="${ROADMAP_SCOPES.join(" ")}"`;
}

export function roadmapMcpToolAuthenticationChallenge(request: Request) {
  return `${roadmapMcpAuthenticationChallenge(request)}, error="insufficient_scope", error_description="Carnival roadmap authorization is required."`;
}
