import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  MongoRoadmapOAuthRepository,
  type RoadmapOAuthClient,
  type RoadmapOAuthCode,
  type RoadmapOAuthRefreshToken,
  type RoadmapOAuthToken,
} from "./roadmap-oauth-repository.server";

export const ROADMAP_SCOPE = "roadmap:read";
export const ROADMAP_WRITE_SCOPE = "roadmap:write";
export const ROADMAP_SCOPES = [ROADMAP_SCOPE, ROADMAP_WRITE_SCOPE] as const;
export const ROADMAP_AUTHORIZATION_REDIRECT_STATUS = 303;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1_000;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const CHATGPT_STABLE_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const CHATGPT_CALLBACK_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]+$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

export type ValidAuthorizationRequest = {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resource: string;
  scope: string[];
  state: string | null;
};

export type RoadmapOAuthRepository = {
  consumeCode(codeHash: string): Promise<boolean>;
  findClient(issuer: string, clientId: string): Promise<RoadmapOAuthClient | null>;
  findCode(codeHash: string): Promise<RoadmapOAuthCode | null>;
  findRefreshToken(tokenHash: string, now: Date): Promise<RoadmapOAuthRefreshToken | null>;
  findToken(tokenHash: string, now: Date): Promise<RoadmapOAuthToken | null>;
  consumeRefreshToken(tokenHash: string, now: Date): Promise<RoadmapOAuthRefreshToken | null>;
  insertClient(client: RoadmapOAuthClient): Promise<void>;
  insertCode(code: RoadmapOAuthCode): Promise<void>;
  insertRefreshToken(token: RoadmapOAuthRefreshToken): Promise<void>;
  insertToken(token: RoadmapOAuthToken): Promise<void>;
};

export class RoadmapOAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "RoadmapOAuthError";
  }
}

function hashSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

function valuesEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requestedScopes(value: string | null) {
  const scopes = [...new Set((value ?? "").split(/\s+/).filter(Boolean))];
  if (!scopes.length || scopes.some((scope) => !ROADMAP_SCOPES.includes(scope as typeof ROADMAP_SCOPES[number]))) {
    throw new RoadmapOAuthError("invalid_scope", `Supported scopes are ${ROADMAP_SCOPES.join(" and ")}.`);
  }
  return ROADMAP_SCOPES.filter((scope) => scopes.includes(scope));
}

function validOAuthRedirect(value: string) {
  try {
    const url = new URL(value);
    const chatGptRedirect = url.origin === "https://chatgpt.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.href === CHATGPT_STABLE_REDIRECT || CHATGPT_CALLBACK_PATH.test(url.pathname));
    const inspectorLoopbackRedirect = url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "[::1]") &&
      Boolean(url.port) &&
      url.pathname === "/oauth/callback" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
    return chatGptRedirect || inspectorLoopbackRedirect;
  } catch {
    return false;
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

export function roadmapOAuthIssuer(request: Request) {
  return new URL(request.url).origin;
}

export function roadmapMcpResource(issuer: string) {
  return `${issuer}/api/development/mcp`;
}

export function roadmapOAuthConsentDescription(scopes: readonly string[]) {
  const canRead = scopes.includes(ROADMAP_SCOPE);
  const canWrite = scopes.includes(ROADMAP_WRITE_SCOPE);
  if (canRead && canWrite) {
    return "ChatGPT is requesting permission to read and make your explicitly requested Development Roadmap changes. It cannot delete features or components.";
  }
  if (canWrite) {
    return "ChatGPT is requesting permission to make your explicitly requested Development Roadmap changes. It cannot delete features or components.";
  }
  return "ChatGPT is requesting read-only access to your Carnival Development Roadmap. It cannot create, edit, delete, move, or reorder roadmap data.";
}

export function roadmapAuthorizationServerMetadata(issuer: string) {
  return {
    authorization_endpoint: `${issuer}/oauth/authorize`,
    authorization_response_iss_parameter_supported: true,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    issuer,
    registration_endpoint: `${issuer}/api/oauth/register`,
    response_types_supported: ["code"],
    scopes_supported: [...ROADMAP_SCOPES],
    token_endpoint: `${issuer}/api/oauth/token`,
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export class CarnivalRoadmapOAuthService {
  constructor(
    private readonly repository: RoadmapOAuthRepository = new MongoRoadmapOAuthRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async registerClient(issuer: string, input: unknown) {
    const record = typeof input === "object" && input !== null
      ? input as Record<string, unknown>
      : {};
    const redirectUris = stringArray(record.redirect_uris);
    const grantTypes = record.grant_types === undefined
      ? ["authorization_code", "refresh_token"]
      : stringArray(record.grant_types);
    const responseTypes = record.response_types === undefined
      ? ["code"]
      : stringArray(record.response_types);
    if (
      !redirectUris?.length ||
      redirectUris.length > 4 ||
      !redirectUris.every(validOAuthRedirect) ||
      !grantTypes?.includes("authorization_code") ||
      grantTypes.some((grantType) => !["authorization_code", "refresh_token"].includes(grantType)) ||
      !responseTypes?.includes("code") ||
      (record.token_endpoint_auth_method !== undefined && record.token_endpoint_auth_method !== "none")
    ) {
      throw new RoadmapOAuthError("invalid_client_metadata", "Unsupported OAuth client metadata.");
    }
    const clientId = `carnival_${randomSecret()}`;
    const clientName = typeof record.client_name === "string" && record.client_name.trim()
      ? record.client_name.trim().slice(0, 120)
      : "ChatGPT";
    const createdAt = this.now();
    await this.repository.insertClient({ clientId, clientName, createdAt, issuer, redirectUris });
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(createdAt.getTime() / 1_000),
      client_name: clientName,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: redirectUris,
      response_types: ["code"],
      scope: ROADMAP_SCOPES.join(" "),
      token_endpoint_auth_method: "none",
    };
  }

  async validateAuthorizationRequest(issuer: string, parameters: URLSearchParams) {
    if (parameters.get("response_type") !== "code") {
      throw new RoadmapOAuthError("unsupported_response_type", "Authorization code flow is required.");
    }
    const clientId = parameters.get("client_id")?.trim() ?? "";
    const redirectUri = parameters.get("redirect_uri")?.trim() ?? "";
    const client = clientId ? await this.repository.findClient(issuer, clientId) : null;
    if (!client || !client.redirectUris.includes(redirectUri)) {
      throw new RoadmapOAuthError("invalid_client", "OAuth client or redirect URI is invalid.", 401);
    }
    const resource = parameters.get("resource")?.trim() ?? "";
    if (resource !== roadmapMcpResource(issuer)) {
      throw new RoadmapOAuthError("invalid_target", "The requested OAuth resource is invalid.");
    }
    const codeChallenge = parameters.get("code_challenge")?.trim() ?? "";
    if (parameters.get("code_challenge_method") !== "S256" || !PKCE_CHALLENGE.test(codeChallenge)) {
      throw new RoadmapOAuthError("invalid_request", "PKCE S256 is required.");
    }
    return {
      clientId,
      codeChallenge,
      redirectUri,
      resource,
      scope: requestedScopes(parameters.get("scope")),
      state: parameters.get("state"),
    } satisfies ValidAuthorizationRequest;
  }

  async issueAuthorizationCode(
    issuer: string,
    ownerUserId: string,
    request: ValidAuthorizationRequest,
  ) {
    const code = randomSecret();
    const createdAt = this.now();
    await this.repository.insertCode({
      clientId: request.clientId,
      codeChallenge: request.codeChallenge,
      codeHash: hashSecret(code),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + AUTHORIZATION_CODE_TTL_MS),
      issuer,
      ownerUserId,
      redirectUri: request.redirectUri,
      resource: request.resource,
      scope: request.scope,
    });
    return code;
  }

  async exchangeToken(issuer: string, parameters: URLSearchParams) {
    const grantType = parameters.get("grant_type");
    if (grantType === "authorization_code") {
      return this.exchangeAuthorizationCode(issuer, parameters);
    }
    if (grantType === "refresh_token") {
      return this.exchangeRefreshToken(issuer, parameters);
    }
    throw new RoadmapOAuthError(
      "unsupported_grant_type",
      "Authorization code or refresh token grant is required.",
    );
  }

  async exchangeAuthorizationCode(issuer: string, parameters: URLSearchParams) {
    const code = parameters.get("code") ?? "";
    const stored = code ? await this.repository.findCode(hashSecret(code)) : null;
    const now = this.now();
    if (!stored || stored.expiresAt.getTime() <= now.getTime() || stored.issuer !== issuer) {
      throw new RoadmapOAuthError("invalid_grant", "Authorization code is invalid or expired.");
    }
    const clientId = parameters.get("client_id")?.trim() ?? "";
    const redirectUri = parameters.get("redirect_uri")?.trim() ?? "";
    const resource = parameters.get("resource")?.trim() ?? "";
    const verifier = parameters.get("code_verifier") ?? "";
    const actualChallenge = PKCE_VERIFIER.test(verifier)
      ? createHash("sha256").update(verifier, "utf8").digest("base64url")
      : "";
    if (
      clientId !== stored.clientId ||
      redirectUri !== stored.redirectUri ||
      resource !== stored.resource ||
      !actualChallenge ||
      !valuesEqual(actualChallenge, stored.codeChallenge)
    ) {
      throw new RoadmapOAuthError("invalid_grant", "Authorization code validation failed.");
    }
    if (!await this.repository.consumeCode(stored.codeHash)) {
      throw new RoadmapOAuthError("invalid_grant", "Authorization code was already used.");
    }
    return this.issueTokenPair({
      audience: stored.resource,
      clientId: stored.clientId,
      issuer,
      now,
      ownerUserId: stored.ownerUserId,
      scope: stored.scope,
    });
  }

  private async exchangeRefreshToken(issuer: string, parameters: URLSearchParams) {
    const refreshToken = parameters.get("refresh_token") ?? "";
    const refreshTokenHash = refreshToken ? hashSecret(refreshToken) : "";
    const now = this.now();
    const stored = refreshTokenHash
      ? await this.repository.findRefreshToken(refreshTokenHash, now)
      : null;
    if (!stored || stored.issuer !== issuer) {
      throw new RoadmapOAuthError("invalid_grant", "Refresh token is invalid or expired.");
    }
    const clientId = parameters.get("client_id")?.trim() ?? "";
    const client = clientId ? await this.repository.findClient(issuer, clientId) : null;
    const requestedResource = parameters.get("resource")?.trim() ?? "";
    if (
      !client ||
      clientId !== stored.clientId ||
      (requestedResource && requestedResource !== stored.audience)
    ) {
      throw new RoadmapOAuthError("invalid_grant", "Refresh token validation failed.");
    }
    const requestedScope = parameters.get("scope");
    const scope = requestedScope === null
      ? stored.scope
      : requestedScopes(requestedScope);
    if (scope.some((item) => !stored.scope.includes(item))) {
      throw new RoadmapOAuthError("invalid_scope", "A refresh cannot increase the granted scope.");
    }
    if (!await this.repository.consumeRefreshToken(refreshTokenHash, now)) {
      throw new RoadmapOAuthError("invalid_grant", "Refresh token was already used.");
    }
    return this.issueTokenPair({
      audience: stored.audience,
      clientId: stored.clientId,
      issuer,
      now,
      ownerUserId: stored.ownerUserId,
      scope,
    });
  }

  private async issueTokenPair(input: {
    audience: string;
    clientId: string;
    issuer: string;
    now: Date;
    ownerUserId: string;
    scope: string[];
  }) {
    const accessToken = randomSecret();
    const refreshToken = randomSecret();
    const expiresAt = new Date(input.now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1_000);
    await this.repository.insertToken({
      audience: input.audience,
      clientId: input.clientId,
      createdAt: input.now,
      expiresAt,
      issuer: input.issuer,
      ownerUserId: input.ownerUserId,
      scope: input.scope,
      tokenHash: hashSecret(accessToken),
    });
    await this.repository.insertRefreshToken({
      audience: input.audience,
      clientId: input.clientId,
      createdAt: input.now,
      expiresAt: new Date(input.now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1_000),
      issuer: input.issuer,
      ownerUserId: input.ownerUserId,
      scope: input.scope,
      tokenHash: hashSecret(refreshToken),
    });
    return {
      access_token: accessToken,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: input.scope.join(" "),
      token_type: "Bearer",
    };
  }

  async authenticateAccessToken(issuer: string, accessToken: string) {
    const token = await this.repository.findToken(hashSecret(accessToken), this.now());
    return token &&
      token.issuer === issuer &&
      token.audience === roadmapMcpResource(issuer) &&
      token.scope.some((scope) => ROADMAP_SCOPES.includes(scope as typeof ROADMAP_SCOPES[number]))
      ? { ownerUserId: token.ownerUserId, scopes: token.scope }
      : null;
  }
}

export function authorizationRedirect(
  issuer: string,
  request: ValidAuthorizationRequest,
  values: { code?: string; error?: string },
) {
  const redirect = new URL(request.redirectUri);
  if (values.code) redirect.searchParams.set("code", values.code);
  if (values.error) redirect.searchParams.set("error", values.error);
  if (request.state !== null) redirect.searchParams.set("state", request.state);
  redirect.searchParams.set("iss", issuer);
  return redirect;
}
