import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/development/mcp-auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/development/mcp-auth.server")>();
  return {
    ...actual,
    authenticateRoadmapMcpRequest: vi.fn().mockResolvedValue(null),
  };
});

import { POST } from "./route";

describe("Development roadmap MCP authentication", () => {
  it("fails closed with OAuth discovery and no roadmap information", async () => {
    const response = await POST(new Request("https://carnival.example/api/development/mcp", {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "https://carnival.example/.well-known/oauth-protected-resource/api/development/mcp",
    );
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});
