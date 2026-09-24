import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import type {
  DevelopmentComponentRecord,
  DevelopmentFeature,
} from "../../domain/development-feature";
import {
  buildRoadmap,
  filterRoadmap,
  roadmapFeatureByReference,
  roadmapReadTokenIsValid,
  ROADMAP_SCHEMA,
} from "./roadmap";

const token = "roadmap-read-token-that-is-at-least-thirty-two-characters";
const component: DevelopmentComponentRecord = {
  createdAt: "2026-09-24T08:00:00.000Z",
  hidden: true,
  icon: "roller",
  id: "f287f542-f896-42b9-8711-8e221e59a779",
  name: "Roller",
  sortOrder: 1,
  updatedAt: "2026-09-24T08:00:00.000Z",
};
const features: DevelopmentFeature[] = [
  {
    component: "Roller",
    componentId: component.id,
    createdAt: "2026-09-24T09:00:00.000Z",
    dependencies: ["34a28cb5-e40d-4da5-98b3-69d8de358c4d"],
    description: "Build after the foundation",
    featureId: "CF-014",
    id: "205d0598-b93c-49e1-aec3-4dac945e6e0a",
    notes: "Roadmap note",
    priority: "High",
    sequence: 2,
    status: "Planned",
    title: "Carousel associated with a branch",
    updatedAt: "2026-09-24T09:00:00.000Z",
  },
  {
    component: "Roller",
    componentId: component.id,
    createdAt: "2026-09-24T08:00:00.000Z",
    dependencies: [],
    description: "Foundation",
    featureId: "CF-008",
    id: "34a28cb5-e40d-4da5-98b3-69d8de358c4d",
    notes: "",
    priority: "Medium",
    sequence: 1,
    status: "Ready",
    title: "Branch foundation",
    updatedAt: "2026-09-24T08:00:00.000Z",
  },
];

describe("read-only Development roadmap", () => {
  it("accepts only the configured bearer token without exposing it", () => {
    expect(roadmapReadTokenIsValid(`Bearer ${token}`, token)).toBe(true);
    expect(roadmapReadTokenIsValid(null, token)).toBe(false);
    expect(roadmapReadTokenIsValid("Bearer incorrect-token", token)).toBe(false);
    expect(roadmapReadTokenIsValid(`Basic ${token}`, token)).toBe(false);
    expect(JSON.stringify(ROADMAP_SCHEMA)).not.toContain(token);
  });

  it("returns complete canonical data, hidden components, and human dependency references", () => {
    const roadmap = buildRoadmap([component], features);
    expect(roadmap.components).toEqual([component]);
    expect(roadmap.globalSequence).toEqual(["CF-008", "CF-014"]);
    expect(roadmap.features[1]).toEqual(expect.objectContaining({
      description: "Build after the foundation",
      featureId: "CF-014",
      notes: "Roadmap note",
      sequence: 2,
    }));
    expect(roadmap.features[1].dependencies).toEqual([{
      featureId: "CF-008",
      id: "34a28cb5-e40d-4da5-98b3-69d8de358c4d",
      title: "Branch foundation",
    }]);
  });

  it("filters by ID search, component, status, and priority case-insensitively", () => {
    const roadmap = buildRoadmap([component], features);
    expect(filterRoadmap(roadmap, { q: "cf-014" }).features.map((item) => item.featureId))
      .toEqual(["CF-014"]);
    expect(filterRoadmap(roadmap, { component: "roller", status: "planned", priority: "high" })
      .features.map((item) => item.featureId)).toEqual(["CF-014"]);
  });

  it("looks up one complete feature by canonical reference case-insensitively", () => {
    const roadmap = buildRoadmap([component], features);
    expect(roadmapFeatureByReference(roadmap, "cf-014"))
      .toEqual(expect.objectContaining({ featureId: "CF-014", title: features[0].title }));
    expect(roadmapFeatureByReference(roadmap, "not-an-id")).toBeNull();
  });

  it("exposes GET-only token-protected roadmap, direct lookup, and schema routes", async () => {
    const route = await readFile(new URL("../../app/api/development/roadmap/route.ts", import.meta.url), "utf8");
    const itemRoute = await readFile(new URL("../../app/api/development/roadmap/[featureId]/route.ts", import.meta.url), "utf8");
    const schemaRoute = await readFile(new URL("../../app/api/development/roadmap/schema/route.ts", import.meta.url), "utf8");
    for (const source of [route, itemRoute, schemaRoute]) {
      expect(source).toContain("roadmapReadTokenIsValid");
      expect(source).toContain("CARNIVAL_ROADMAP_READ_TOKEN");
      expect(source).toContain("export async function GET");
      expect(source).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
    }
  });
});
