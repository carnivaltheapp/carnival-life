import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabaseConfig } from "../supabase/config";
import { MongoDevelopmentFeatureRepository } from "./repository";
import { roadmapReadTokenIsValid } from "./roadmap";

export type RoadmapMcpIdentity = {
  ownerUserId: string;
  source: "oauth" | "roadmap-token";
};

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1] ?? null;
}

export async function authenticateRoadmapMcpRequest(
  request: Request,
): Promise<RoadmapMcpIdentity | null> {
  const token = bearerToken(request);
  if (!token) return null;

  if (roadmapReadTokenIsValid(`Bearer ${token}`, process.env.CARNIVAL_ROADMAP_READ_TOKEN)) {
    const ownerUserId = await new MongoDevelopmentFeatureRepository().machineRoadmapOwner();
    return ownerUserId ? { ownerUserId, source: "roadmap-token" } : null;
  }

  const { publishableKey, url } = getSupabaseConfig();
  const supabase = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const ownerUserId = data?.claims?.sub;
  return error || typeof ownerUserId !== "string" || !ownerUserId.trim()
    ? null
    : { ownerUserId, source: "oauth" };
}

export function roadmapMcpResourceMetadata(request: Request) {
  const { url } = getSupabaseConfig();
  const origin = new URL(request.url).origin;
  return {
    authorization_servers: [`${url.replace(/\/$/, "")}/auth/v1`],
    resource: `${origin}/api/development/mcp`,
    resource_documentation: `${origin}/development`,
    scopes_supported: ["openid", "email", "profile"],
  };
}

export function roadmapMcpAuthenticationChallenge(request: Request) {
  const origin = new URL(request.url).origin;
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource/api/development/mcp`;
  return `Bearer resource_metadata="${metadataUrl}", scope="openid email profile"`;
}
