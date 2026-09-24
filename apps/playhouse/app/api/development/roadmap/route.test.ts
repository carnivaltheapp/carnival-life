import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/development/roadmap.server", () => ({
  loadMachineRoadmap: vi.fn().mockResolvedValue({
    components: [{
      createdAt: "2026-09-24T08:00:00.000Z",
      hidden: false,
      icon: "house",
      id: "684fa2ea-3077-47a4-b288-0ecf634ddf5f",
      name: "PlayHouse",
      sortOrder: 0,
      updatedAt: "2026-09-24T08:00:00.000Z",
    }],
    dependencies: [],
    features: [{
      component: "PlayHouse",
      componentId: "684fa2ea-3077-47a4-b288-0ecf634ddf5f",
      createdAt: "2026-09-24T08:00:00.000Z",
      dependencies: [],
      description: "Description",
      featureId: "CF-001",
      id: "34a28cb5-e40d-4da5-98b3-69d8de358c4d",
      notes: "Notes",
      priority: "High",
      sequence: 1,
      status: "Ready",
      title: "Feature",
      updatedAt: "2026-09-24T08:00:00.000Z",
    }],
    globalSequence: ["CF-001"],
  }),
}));

import { GET as getRoadmap } from "./route";
import { GET as getFeature } from "./[featureId]/route";
import { GET as getSchema } from "./schema/route";

const token = "a-cryptographically-strong-roadmap-read-token";

describe("Development roadmap route authentication", () => {
  beforeEach(() => {
    process.env.CARNIVAL_ROADMAP_READ_TOKEN = token;
  });

  afterEach(() => {
    delete process.env.CARNIVAL_ROADMAP_READ_TOKEN;
  });

  it("returns the roadmap for a valid token and never echoes that token", async () => {
    const response = await getRoadmap(new Request("https://example.test/api/development/roadmap", {
      headers: { Authorization: `Bearer ${token}` },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.features[0]).toEqual(expect.objectContaining({ featureId: "CF-001" }));
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it("returns 401 for missing and incorrect tokens", async () => {
    expect((await getRoadmap(new Request("https://example.test/api/development/roadmap"))).status)
      .toBe(401);
    expect((await getRoadmap(new Request("https://example.test/api/development/roadmap", {
      headers: { Authorization: "Bearer incorrect" },
    }))).status).toBe(401);
  });

  it("serves direct feature lookup and the discovery schema with the same token", async () => {
    const headers = { Authorization: `Bearer ${token}` };
    const featureResponse = await getFeature(
      new Request("https://example.test/api/development/roadmap/CF-001", { headers }),
      { params: Promise.resolve({ featureId: "cf-001" }) },
    );
    expect(featureResponse.status).toBe(200);
    expect((await featureResponse.json()).feature.featureId).toBe("CF-001");
    const schemaResponse = await getSchema(new Request(
      "https://example.test/api/development/roadmap/schema",
      { headers },
    ));
    expect(schemaResponse.status).toBe(200);
    expect((await schemaResponse.json()).writeAccess).toBe(false);
  });
});
