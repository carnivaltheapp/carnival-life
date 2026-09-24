import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { RoadmapResponse } from "./roadmap";
import { createRoadmapMcpServer } from "./mcp.server";

const roadmap: RoadmapResponse = {
  components: [{
    createdAt: "2026-09-24T08:00:00.000Z",
    hidden: false,
    icon: "roller",
    id: "component-roller",
    name: "Roller",
    sortOrder: 1,
    updatedAt: "2026-09-24T08:00:00.000Z",
  }],
  dependencies: [{ dependsOnFeatureId: "CF-009", featureId: "CF-010" }],
  features: [
    {
      component: "Roller",
      componentId: "component-roller",
      createdAt: "2026-09-24T08:00:00.000Z",
      dependencies: [],
      description: "Foundation",
      featureId: "CF-009",
      id: "internal-009",
      notes: "Planning foundation",
      priority: "Medium",
      sequence: 9,
      status: "Ready",
      title: "Roller foundation",
      updatedAt: "2026-09-24T08:00:00.000Z",
    },
    {
      component: "Carousel",
      componentId: "component-carousel",
      createdAt: "2026-09-24T09:00:00.000Z",
      dependencies: [{ featureId: "CF-009", id: "internal-009", title: "Roller foundation" }],
      description: "Associate Carousel with a branch",
      featureId: "CF-010",
      id: "internal-010",
      notes: "Private-note-only phrase: aurora sequencing",
      priority: "High",
      sequence: 10,
      status: "Planned",
      title: "Carousel associated with a branch",
      updatedAt: "2026-09-24T09:00:00.000Z",
    },
    {
      component: "Roller",
      componentId: "component-roller",
      createdAt: "2026-09-24T10:00:00.000Z",
      dependencies: [],
      description: "Later Roller work",
      featureId: "CF-011",
      id: "internal-011",
      notes: "",
      priority: "Low",
      sequence: 11,
      status: "Planned",
      title: "Roller forecast",
      updatedAt: "2026-09-24T10:00:00.000Z",
    },
  ],
  globalSequence: ["CF-009", "CF-010", "CF-011"],
};

function writerReturning(value: RoadmapResponse = roadmap) {
  return {
    addDependency: vi.fn().mockResolvedValue(value),
    appendNotes: vi.fn().mockResolvedValue(value),
    removeDependency: vi.fn().mockResolvedValue(value),
    reorderFeature: vi.fn().mockResolvedValue(value),
    updateFeature: vi.fn().mockResolvedValue(value),
  };
}

async function connectedClient(
  access: Parameters<typeof createRoadmapMcpServer>[0] = "owner-a",
  writer = writerReturning(),
) {
  const server = createRoadmapMcpServer(access, async () => roadmap, writer);
  const client = new Client({ name: "roadmap-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, writer };
}

const opened: Array<{ client: Client; server: ReturnType<typeof createRoadmapMcpServer> }> = [];

async function call(name: string, args: Record<string, unknown> = {}) {
  const connection = await connectedClient();
  opened.push(connection);
  return connection.client.callTool({ arguments: args, name });
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map(async ({ client, server }) => {
    await client.close();
    await server.close();
  }));
});

describe("Carnival Development roadmap MCP tools", () => {
  it("retrieves CF-010 case-insensitively with dependencies and sequence context", async () => {
    for (const reference of ["CF-010", "cf-010"]) {
      const response = await call("get_feature", { featureId: reference });
      expect(response.structuredContent).toEqual({
        feature: expect.objectContaining({
          dependencies: [{ featureId: "CF-009", id: "internal-009", title: "Roller foundation" }],
          featureId: "CF-010",
          nextFeature: { featureId: "CF-011", title: "Roller forecast" },
          previousFeature: { featureId: "CF-009", title: "Roller foundation" },
        }),
        found: true,
      });
    }
  });

  it("returns a clean not-found result for an unknown CF reference", async () => {
    await expect(call("get_feature", { featureId: "CF-999" })).resolves.toEqual(
      expect.objectContaining({ structuredContent: { feature: null, found: false } }),
    );
  });

  it("searches titles and Notes and filters component, status, and priority", async () => {
    expect((await call("search_features", { query: "Carousel" })).structuredContent)
      .toEqual({ features: [expect.objectContaining({ featureId: "CF-010" })] });
    expect((await call("search_features", { query: "aurora sequencing" })).structuredContent)
      .toEqual({ features: [expect.objectContaining({ featureId: "CF-010" })] });
    expect((await call("list_features", { component: "Roller", status: "Planned", priority: "Low" }))
      .structuredContent).toEqual({ features: [expect.objectContaining({ featureId: "CF-011" })] });
  });

  it("returns the canonical roadmap and requests the complete read/write grant during linking", async () => {
    expect((await call("get_roadmap")).structuredContent).toEqual(roadmap);
    expect((await call("list_components")).structuredContent).toEqual({ components: roadmap.components });
    const connection = await connectedClient();
    opened.push(connection);
    const tools = await connection.client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
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
    expect(tools.tools.slice(0, 5).every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.tools.slice(5).every((tool) => tool.annotations?.readOnlyHint === false)).toBe(true);
    expect(tools.tools.every((tool) => {
      const schemes = tool._meta?.securitySchemes;
      return Array.isArray(schemes) && schemes.some((scheme) =>
        typeof scheme === "object" && scheme !== null &&
        "type" in scheme && scheme.type === "oauth2" &&
        "scopes" in scheme && Array.isArray(scheme.scopes) &&
        scheme.scopes.includes("roadmap:read") &&
        scheme.scopes.includes("roadmap:write"));
    })).toBe(true);
    expect(tools.tools.map((tool) => tool.name).join(" ")).not.toMatch(/delete_feature|delete_component|mongo/);
  });

  it("executes each explicitly requested write through the owner-scoped mutation service", async () => {
    const connection = await connectedClient();
    opened.push(connection);
    await connection.client.callTool({
      arguments: { changes: { priority: "High" }, featureId: "CF-010" },
      name: "update_feature",
    });
    await connection.client.callTool({
      arguments: { featureId: "CF-011", sequence: 1 },
      name: "reorder_feature",
    });
    await connection.client.callTool({
      arguments: { dependencyFeatureId: "CF-009", featureId: "CF-011" },
      name: "add_dependency",
    });
    await connection.client.callTool({
      arguments: { dependencyFeatureId: "CF-009", featureId: "CF-010" },
      name: "remove_dependency",
    });
    await connection.client.callTool({
      arguments: { featureId: "CF-010", text: "Explicitly requested note." },
      name: "append_notes",
    });
    expect(connection.writer.updateFeature).toHaveBeenCalledWith(
      "owner-a", "CF-010", { priority: "High" },
    );
    expect(connection.writer.reorderFeature).toHaveBeenCalledWith("owner-a", "CF-011", 1);
    expect(connection.writer.addDependency).toHaveBeenCalledWith("owner-a", "CF-011", "CF-009");
    expect(connection.writer.removeDependency).toHaveBeenCalledWith("owner-a", "CF-010", "CF-009");
    expect(connection.writer.appendNotes).toHaveBeenCalledWith(
      "owner-a", "CF-010", "Explicitly requested note.",
    );
  });

  it("never permits a read-only OAuth identity to invoke write tools", async () => {
    const writer = writerReturning();
    const connection = await connectedClient({
      ownerUserId: "owner-a",
      scopes: ["roadmap:read"],
      writeAuthenticationChallenge: 'Bearer scope="roadmap:write", error="insufficient_scope"',
    }, writer);
    opened.push(connection);
    expect((await connection.client.callTool({
      arguments: { changes: { priority: "High" }, featureId: "CF-010" },
      name: "update_feature",
    })).isError).toBe(true);
    expect(writer.updateFeature).not.toHaveBeenCalled();
  });

  it("rejects fields outside the update_feature allowlist before mutation", async () => {
    const writer = writerReturning();
    const connection = await connectedClient("owner-a", writer);
    opened.push(connection);
    const response = await connection.client.callTool({
      arguments: { changes: { sequence: 1 }, featureId: "CF-010" },
      name: "update_feature",
    });
    expect(response.isError).toBe(true);
    expect(writer.updateFeature).not.toHaveBeenCalled();
  });

  it("passes the authorized owner identity to every Mongo-backed tool load", async () => {
    const owners: string[] = [];
    const server = createRoadmapMcpServer("owner-b", async (ownerUserId) => {
      owners.push(ownerUserId);
      return roadmap;
    });
    const client = new Client({ name: "owner-isolation-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    opened.push({ client, server });
    await client.callTool({ arguments: { featureId: "CF-010" }, name: "get_feature" });
    expect(owners).toEqual(["owner-b"]);
  });

  it("returns the ChatGPT OAuth trigger without reading roadmap data when unauthenticated", async () => {
    const loadRoadmap = vi.fn();
    const server = createRoadmapMcpServer({
      readAuthenticationChallenge:
        'Bearer resource_metadata="https://carnival.example/.well-known/oauth-protected-resource/api/development/mcp", scope="roadmap:read", error="insufficient_scope", error_description="Carnival roadmap authorization is required."',
      writeAuthenticationChallenge:
        'Bearer resource_metadata="https://carnival.example/.well-known/oauth-protected-resource/api/development/mcp", scope="roadmap:write", error="insufficient_scope", error_description="Carnival roadmap authorization is required."',
    }, loadRoadmap);
    const client = new Client({ name: "unauthenticated-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    opened.push({ client, server });

    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(10);
    const response = await client.callTool({ arguments: { featureId: "CF-010" }, name: "get_feature" });
    expect(response).toEqual(expect.objectContaining({
      isError: true,
      _meta: {
        "mcp/www_authenticate": [expect.stringContaining("insufficient_scope")],
      },
    }));
    expect(loadRoadmap).not.toHaveBeenCalled();
  });
});
