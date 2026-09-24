import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  authenticateRoadmapMcpRequest,
  roadmapMcpResourceMetadata,
} from "./mcp-auth.server";

describe("Carnival roadmap MCP bearer authentication", () => {
  it("uses Carnival OAuth tokens and publishes Carnival-owned resource metadata", async () => {
    const request = new Request("https://carnival.example/api/development/mcp", {
      headers: { Authorization: "Bearer carnival-access-token" },
    });
    const authenticateAccessToken = vi.fn().mockResolvedValue({
      ownerUserId: "owner-a",
      scopes: ["roadmap:read"],
    });
    await expect(authenticateRoadmapMcpRequest(request, { authenticateAccessToken })).resolves.toEqual({
      ownerUserId: "owner-a",
      scopes: ["roadmap:read"],
      source: "oauth",
    });
    expect(authenticateAccessToken).toHaveBeenCalledWith(
      "https://carnival.example",
      "carnival-access-token",
    );
    expect(roadmapMcpResourceMetadata(request)).toEqual({
      authorization_servers: ["https://carnival.example"],
      resource: "https://carnival.example/api/development/mcp",
      resource_documentation: "https://carnival.example/development",
      scopes_supported: ["roadmap:read", "roadmap:write"],
    });
  });

  it("rejects invalid Carnival access tokens", async () => {
    const authenticateAccessToken = vi.fn().mockResolvedValue(null);
    await expect(authenticateRoadmapMcpRequest(
      new Request("https://carnival.example/api/development/mcp", {
        headers: { Authorization: "Bearer invalid" },
      }),
      { authenticateAccessToken },
    )).resolves.toBeNull();
  });
});
