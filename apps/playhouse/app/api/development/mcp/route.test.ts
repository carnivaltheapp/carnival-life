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
  function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return POST(new Request("https://carnival.example/api/development/mcp", {
      body: JSON.stringify(body),
      headers: { "Accept": "application/json, text/event-stream", "Content-Type": "application/json", ...headers },
      method: "POST",
    }));
  }

  it("exposes the MCP handshake and separately scoped read/write tool descriptors before OAuth", async () => {
    const initialized = await request({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "chatgpt-test", version: "1.0.0" },
        protocolVersion: "2025-06-18",
      },
    });
    expect(initialized.status).toBe(200);
    expect((await initialized.json()).result.serverInfo.name).toBe("carnival-development-roadmap");

    const listed = await request({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} });
    expect(listed.status).toBe(200);
    const tools = (await listed.json()).result.tools;
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
      "get_feature",
      "search_features",
      "list_features",
      "list_components",
      "get_roadmap",
      "update_feature",
      "reorder_feature",
      "add_dependency",
      "remove_dependency",
      "append_notes",
    ]);
    expect(tools.every((tool: { _meta?: { securitySchemes?: unknown[] } }) =>
      tool._meta?.securitySchemes?.some((scheme) =>
        typeof scheme === "object" && scheme !== null &&
        "type" in scheme && scheme.type === "oauth2"))).toBe(true);
    expect(tools.every((tool: { securitySchemes?: unknown[] }) =>
      tool.securitySchemes?.some((scheme) =>
        typeof scheme === "object" && scheme !== null &&
        "type" in scheme && scheme.type === "oauth2"))).toBe(true);
    expect(tools.slice(0, 5).every((tool: { securitySchemes?: Array<{ scopes?: string[] }> }) =>
      tool.securitySchemes?.some((scheme) => scheme.scopes?.includes("roadmap:read")))).toBe(true);
    expect(tools.slice(5).every((tool: { securitySchemes?: Array<{ scopes?: string[] }> }) =>
      tool.securitySchemes?.some((scheme) => scheme.scopes?.includes("roadmap:write")))).toBe(true);
  });

  it("returns a tool-level OAuth challenge without loading private roadmap data", async () => {
    const response = await request({
      id: 3,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: { featureId: "CF-010" }, name: "get_feature" },
    });
    expect(response.status).toBe(200);
    const result = (await response.json()).result;
    expect(result.isError).toBe(true);
    expect(result._meta["mcp/www_authenticate"][0]).toContain("insufficient_scope");
    expect(result._meta["mcp/www_authenticate"][0]).toContain(
      "https://carnival.example/.well-known/oauth-protected-resource/api/development/mcp",
    );
  });

  it("returns the separate roadmap:write challenge for mutation tools", async () => {
    const response = await request({
      id: 4,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: { changes: { priority: "High" }, featureId: "CF-012" },
        name: "update_feature",
      },
    });
    expect(response.status).toBe(200);
    const result = (await response.json()).result;
    expect(result.isError).toBe(true);
    expect(result._meta["mcp/www_authenticate"][0]).toContain('scope="roadmap:write"');
  });

  it("rejects an invalid supplied bearer token with OAuth discovery", async () => {
    const response = await POST(new Request("https://carnival.example/api/development/mcp", {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
      headers: { Authorization: "Bearer invalid", "Content-Type": "application/json" },
      method: "POST",
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "https://carnival.example/.well-known/oauth-protected-resource/api/development/mcp",
    );
    expect(response.headers.get("www-authenticate")).toContain('scope="roadmap:read"');
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});
