import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DevelopmentFeature } from "../../domain/development-feature";
import { loadPublicDevelopmentFeature } from "./roadmap.server";

const longNotes = `First paragraph.\n\n${"Detailed roadmap context. ".repeat(500)}`;
const feature: DevelopmentFeature = {
  component: "PlayHouse",
  componentId: "component-internal-id",
  createdAt: "2026-09-20T12:00:00.000Z",
  dependencies: ["dependency-internal-id"],
  description: "Complete feature description.",
  featureId: "CF-010",
  id: "feature-internal-id",
  notes: longNotes,
  priority: "High",
  sequence: 10,
  status: "Building",
  title: "Public feature sharing",
  updatedAt: "2026-09-24T12:00:00.000Z",
};

function repository(featureResult: DevelopmentFeature | null = feature) {
  return {
    get: vi.fn(async (_owner: string, id: string) => id === "dependency-internal-id" ? {
      ...feature,
      dependencies: [],
      featureId: "CF-004",
      id,
      title: "Roadmap foundation",
    } : null),
    getByHumanFeatureId: vi.fn(async () => featureResult),
    machineRoadmapOwner: vi.fn(async () => "private-owner-id"),
  };
}

describe("public Development feature loader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns one complete current feature and dependency summaries without private IDs", async () => {
    const source = repository();
    const result = await loadPublicDevelopmentFeature("CF-010", source);

    expect(source.getByHumanFeatureId).toHaveBeenCalledWith("private-owner-id", "CF-010");
    expect(result).toEqual({
      component: "PlayHouse",
      dependencies: [{ featureId: "CF-004", title: "Roadmap foundation" }],
      description: "Complete feature description.",
      featureId: "CF-010",
      notes: longNotes,
      priority: "High",
      sequence: 10,
      status: "Building",
      title: "Public feature sharing",
      updatedAt: "2026-09-24T12:00:00.000Z",
    });
    expect(result?.notes.length).toBeGreaterThan(10_000);
    expect(result).not.toHaveProperty("id");
    expect(JSON.stringify(result)).not.toContain("private-owner-id");
    expect(JSON.stringify(result)).not.toContain("dependency-internal-id");
  });

  it("returns null for an unknown feature without listing or mutating roadmap data", async () => {
    const source = repository(null);
    await expect(loadPublicDevelopmentFeature("CF-999", source)).resolves.toBeNull();
    expect(source.get).not.toHaveBeenCalled();
  });
});
