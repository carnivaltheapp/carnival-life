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

async function connectedClient() {
  const server = createRoadmapMcpServer("owner-a", async () => roadmap);
  const client = new Client({ name: "roadmap-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
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

  it("returns the canonical roadmap and components and exposes no mutation tools", async () => {
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
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.tools.every((tool) => {
      const schemes = tool._meta?.securitySchemes;
      return Array.isArray(schemes) && schemes.some((scheme) =>
        typeof scheme === "object" && scheme !== null &&
        "type" in scheme && scheme.type === "oauth2" &&
        "scopes" in scheme && Array.isArray(scheme.scopes) &&
        scheme.scopes.includes("roadmap:read"));
    })).toBe(true);
    expect(tools.tools.map((tool) => tool.name).join(" ")).not.toMatch(/create|update|delete|move|reorder/);
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
});
