import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CarnivalRoadmapOAuthService,
  ROADMAP_AUTHORIZATION_REDIRECT_STATUS,
  ROADMAP_SCOPE,
  ROADMAP_WRITE_SCOPE,
  RoadmapOAuthError,
  roadmapAuthorizationServerMetadata,
  roadmapMcpResource,
  roadmapOAuthConsentDescription,
  type RoadmapOAuthRepository,
} from "./roadmap-oauth.server";
import type {
  RoadmapOAuthClient,
  RoadmapOAuthCode,
  RoadmapOAuthToken,
} from "./roadmap-oauth-repository.server";

const issuer = "https://carnival.example";
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
const verifier = "carnival-pkce-verifier-that-is-long-enough-for-oauth-2-1";
const challenge = createHash("sha256").update(verifier).digest("base64url");

class MemoryRepository implements RoadmapOAuthRepository {
  clients: RoadmapOAuthClient[] = [];
  codes: RoadmapOAuthCode[] = [];
  tokens: RoadmapOAuthToken[] = [];

  async insertClient(client: RoadmapOAuthClient) { this.clients.push(client); }
  async findClient(valueIssuer: string, clientId: string) {
    return this.clients.find((item) => item.issuer === valueIssuer && item.clientId === clientId) ?? null;
  }
  async insertCode(code: RoadmapOAuthCode) { this.codes.push(code); }
  async findCode(codeHash: string) {
    return this.codes.find((item) => item.codeHash === codeHash) ?? null;
  }
  async consumeCode(codeHash: string) {
    const index = this.codes.findIndex((item) => item.codeHash === codeHash);
    if (index < 0) return false;
    this.codes.splice(index, 1);
    return true;
  }
  async insertToken(token: RoadmapOAuthToken) { this.tokens.push(token); }
  async findToken(tokenHash: string, now: Date) {
    return this.tokens.find((item) =>
      item.tokenHash === tokenHash && item.expiresAt.getTime() > now.getTime(),
    ) ?? null;
  }
}

function authorizationParameters(clientId: string, overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    resource: roadmapMcpResource(issuer),
    response_type: "code",
    scope: ROADMAP_SCOPE,
    state: "opaque-state",
    ...overrides,
  });
}

async function registeredService(now = new Date("2026-09-24T12:00:00.000Z")) {
  const repository = new MemoryRepository();
  const service = new CarnivalRoadmapOAuthService(repository, () => now);
  const client = await service.registerClient(issuer, {
    client_name: "ChatGPT",
    grant_types: ["authorization_code"],
    redirect_uris: [redirectUri],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  return { client, repository, service };
}

describe("Carnival roadmap OAuth 2.1", () => {
  it("publishes Carnival-owned authorization-code and PKCE discovery", () => {
    expect(roadmapAuthorizationServerMetadata(issuer)).toEqual(expect.objectContaining({
      authorization_endpoint: `${issuer}/oauth/authorize`,
      authorization_response_iss_parameter_supported: true,
      code_challenge_methods_supported: ["S256"],
      issuer,
      registration_endpoint: `${issuer}/api/oauth/register`,
      scopes_supported: [ROADMAP_SCOPE, ROADMAP_WRITE_SCOPE],
      token_endpoint: `${issuer}/api/oauth/token`,
      token_endpoint_auth_methods_supported: ["none"],
    }));
  });

  it("registers only supported ChatGPT public clients", async () => {
    const { client, service } = await registeredService();
    expect(client).toEqual(expect.objectContaining({
      client_id: expect.stringMatching(/^carnival_/),
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    }));
    await expect(service.registerClient(issuer, {
      redirect_uris: ["https://attacker.example/callback"],
    })).rejects.toMatchObject({ code: "invalid_client_metadata" });
  });

  it("issues a one-time code and short-lived token bound to owner, issuer, resource, and scope", async () => {
    const { client, repository, service } = await registeredService();
    const request = await service.validateAuthorizationRequest(
      issuer,
      authorizationParameters(client.client_id),
    );
    const code = await service.issueAuthorizationCode(issuer, "owner-a", request);
    const token = await service.exchangeAuthorizationCode(issuer, new URLSearchParams({
      client_id: client.client_id,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      resource: roadmapMcpResource(issuer),
    }));
    expect(token).toEqual(expect.objectContaining({
      expires_in: 900,
      scope: ROADMAP_SCOPE,
      token_type: "Bearer",
    }));
    expect(await service.authenticateAccessToken(issuer, token.access_token)).toEqual({
      ownerUserId: "owner-a",
      scopes: [ROADMAP_SCOPE],
    });
    expect(repository.codes).toHaveLength(0);
    expect(repository.tokens[0]).toEqual(expect.objectContaining({
      audience: roadmapMcpResource(issuer),
      issuer,
      ownerUserId: "owner-a",
      scope: [ROADMAP_SCOPE],
    }));
    expect(JSON.stringify(repository.tokens)).not.toContain(token.access_token);
    await expect(service.exchangeAuthorizationCode(issuer, new URLSearchParams({
      client_id: client.client_id,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      resource: roadmapMcpResource(issuer),
    }))).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("rejects wrong PKCE, resource, scope, invalid tokens, and expired tokens", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const { client, repository, service } = await registeredService(now);
    await expect(service.validateAuthorizationRequest(
      issuer,
      authorizationParameters(client.client_id, { resource: `${issuer}/wrong` }),
    )).rejects.toMatchObject({ code: "invalid_target" });
    await expect(service.validateAuthorizationRequest(
      issuer,
      authorizationParameters(client.client_id, { scope: "roadmap:admin" }),
    )).rejects.toMatchObject({ code: "invalid_scope" });
    const request = await service.validateAuthorizationRequest(
      issuer,
      authorizationParameters(client.client_id),
    );
    const code = await service.issueAuthorizationCode(issuer, "owner-a", request);
    await expect(service.exchangeAuthorizationCode(issuer, new URLSearchParams({
      client_id: client.client_id,
      code,
      code_verifier: "wrong-verifier-value-that-is-still-long-enough-for-pkce",
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      resource: roadmapMcpResource(issuer),
    }))).rejects.toMatchObject({ code: "invalid_grant" });
    expect(await service.authenticateAccessToken(issuer, "invalid-token")).toBeNull();
    repository.tokens.push({
      audience: roadmapMcpResource(issuer),
      clientId: client.client_id,
      createdAt: new Date(now.getTime() - 2_000),
      expiresAt: new Date(now.getTime() - 1_000),
      issuer,
      ownerUserId: "owner-a",
      scope: [ROADMAP_SCOPE],
      tokenHash: createHash("sha256").update("expired-token").digest("hex"),
    });
    expect(await service.authenticateAccessToken(issuer, "expired-token")).toBeNull();
    const invalidBindings: Array<[
      string,
      Pick<RoadmapOAuthToken, "audience" | "issuer" | "scope">
    ]> = [
      ["wrong-scope", {
        audience: roadmapMcpResource(issuer),
        issuer,
        scope: ["roadmap:admin"],
      }],
      ["wrong-audience", {
        audience: `${issuer}/wrong`,
        issuer,
        scope: [ROADMAP_SCOPE],
      }],
      ["wrong-issuer", {
        audience: roadmapMcpResource(issuer),
        issuer: "https://other.example",
        scope: [ROADMAP_SCOPE],
      }],
    ];
    for (const [accessToken, token] of invalidBindings) {
      repository.tokens.push({
        clientId: client.client_id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
        ownerUserId: "owner-a",
        tokenHash: createHash("sha256").update(accessToken).digest("hex"),
        ...token,
      });
      expect(await service.authenticateAccessToken(issuer, accessToken)).toBeNull();
    }
  });

  it("keeps Supabase OAuth and JWT verification out of the MCP authentication path", () => {
    const root = join(process.cwd(), "lib", "development");
    const auth = readFileSync(join(root, "mcp-auth.server.ts"), "utf8");
    const oauth = readFileSync(join(root, "roadmap-oauth.server.ts"), "utf8");
    expect(`${auth}\n${oauth}`).not.toMatch(/supabase|\.auth\.getClaims|auth\.oauth/i);
  });

  it("issues a separately consented write scope without weakening read-only grants", async () => {
    const { client, repository, service } = await registeredService();
    const request = await service.validateAuthorizationRequest(
      issuer,
      authorizationParameters(client.client_id, { scope: `${ROADMAP_SCOPE} ${ROADMAP_WRITE_SCOPE}` }),
    );
    const code = await service.issueAuthorizationCode(issuer, "owner-a", request);
    const token = await service.exchangeAuthorizationCode(issuer, new URLSearchParams({
      client_id: client.client_id,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      resource: roadmapMcpResource(issuer),
    }));
    expect(token.scope).toBe(`${ROADMAP_SCOPE} ${ROADMAP_WRITE_SCOPE}`);
    expect(repository.tokens[0].scope).toEqual([ROADMAP_SCOPE, ROADMAP_WRITE_SCOPE]);
    expect(await service.authenticateAccessToken(issuer, token.access_token)).toEqual({
      ownerUserId: "owner-a",
      scopes: [ROADMAP_SCOPE, ROADMAP_WRITE_SCOPE],
    });
  });

  it("describes read-only, write-only, and combined consent accurately", () => {
    expect(ROADMAP_AUTHORIZATION_REDIRECT_STATUS).toBe(303);
    expect(roadmapOAuthConsentDescription([ROADMAP_SCOPE])).toContain("read-only access");
    expect(roadmapOAuthConsentDescription([ROADMAP_WRITE_SCOPE])).toContain(
      "permission to make your explicitly requested",
    );
    expect(roadmapOAuthConsentDescription([ROADMAP_WRITE_SCOPE])).not.toContain("read-only");
    expect(roadmapOAuthConsentDescription([ROADMAP_SCOPE, ROADMAP_WRITE_SCOPE])).toContain(
      "permission to read and make your explicitly requested",
    );
  });

  it("uses the existing Carnival session at consent and clearly discloses write access", () => {
    const page = readFileSync(join(process.cwd(), "app", "oauth", "authorize", "page.tsx"), "utf8");
    expect(page).toContain("authenticatedDevelopmentOwner");
    expect(page).toContain("GoogleSignInButton");
    expect(page).toContain("roadmapOAuthConsentDescription");
    expect(RoadmapOAuthError).toBeTypeOf("function");
  });
});
