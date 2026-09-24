import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

describe("Carnival OAuth discovery", () => {
  it("publishes authorization code, DCR, PKCE S256, and roadmap read scope", async () => {
    const response = await GET(new Request(
      "https://carnival.example/.well-known/oauth-authorization-server",
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      authorization_endpoint: "https://carnival.example/oauth/authorize",
      authorization_response_iss_parameter_supported: true,
      code_challenge_methods_supported: ["S256"],
      issuer: "https://carnival.example",
      registration_endpoint: "https://carnival.example/api/oauth/register",
      scopes_supported: ["roadmap:read"],
      token_endpoint: "https://carnival.example/api/oauth/token",
      token_endpoint_auth_methods_supported: ["none"],
    }));
  });
});
