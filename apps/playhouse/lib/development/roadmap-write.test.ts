import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  DevelopmentComponentRecord,
  DevelopmentFeature,
  DevelopmentFeatureInput,
} from "../../domain/development-feature";
import { RoadmapWriteError, RoadmapWriteService } from "./roadmap-write.server";

const componentA = "11111111-1111-4111-8111-111111111111";
const componentB = "22222222-2222-4222-8222-222222222222";
const ids = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
];

function feature(index: number): DevelopmentFeature {
  return {
    component: "PlayHouse",
    componentId: componentA,
    createdAt: `2026-09-2${index}T00:00:00.000Z`,
    dependencies: index === 2 ? [ids[0]] : [],
    description: `Description ${index + 1}`,
    featureId: `CF-00${index + 1}`,
    id: ids[index],
    notes: index === 1 ? "Existing paragraph." : "",
    priority: "Medium",
    sequence: index + 1,
    status: "Planned",
    title: `Feature ${index + 1}`,
    updatedAt: `2026-09-2${index}T00:00:00.000Z`,
  };
}

function repositoryFixture() {
  const components: DevelopmentComponentRecord[] = [
    {
      createdAt: "2026-09-20T00:00:00.000Z",
      hidden: false,
      icon: "house",
      id: componentA,
      name: "PlayHouse",
      sortOrder: 0,
      updatedAt: "2026-09-20T00:00:00.000Z",
    },
    {
      createdAt: "2026-09-20T00:00:00.000Z",
      hidden: false,
      icon: "roller",
      id: componentB,
      name: "Roller",
      sortOrder: 1,
      updatedAt: "2026-09-20T00:00:00.000Z",
    },
  ];
  let features = [feature(0), feature(1), feature(2)];
  const assertOwner = (owner: string) => owner === "owner-a";
  return {
    dependenciesExist: async (owner: string, dependencies: string[], featureId?: string) =>
      assertOwner(owner) && !dependencies.includes(featureId ?? "") &&
      dependencies.every((id) => features.some((item) => item.id === id)),
    getByHumanFeatureId: async (owner: string, reference: string) =>
      assertOwner(owner)
        ? features.find((item) => item.featureId === reference.toUpperCase()) ?? null
        : null,
    list: async (owner: string) => assertOwner(owner) ? [...features] : [],
    listComponents: async (owner: string) => assertOwner(owner) ? components : [],
    reorderFeatures: async (owner: string, featureIds: string[]) => {
      if (!assertOwner(owner) || featureIds.length !== features.length) return false;
      features = featureIds.map((id, index) => ({
        ...features.find((item) => item.id === id)!,
        sequence: index + 1,
      }));
      return true;
    },
    update: async (owner: string, id: string, input: DevelopmentFeatureInput) => {
      if (!assertOwner(owner)) return null;
      const index = features.findIndex((item) => item.id === id);
      const component = components.find((item) => item.id === input.componentId);
      if (index < 0 || !component) return null;
      features[index] = {
        ...features[index],
        ...input,
        component: component.name,
        updatedAt: "2026-09-24T00:00:00.000Z",
      };
      return features[index];
    },
  };
}

describe("owner-scoped roadmap write service", () => {
  it("updates only approved feature fields and resolves an existing component", async () => {
    const repository = repositoryFixture();
    const service = new RoadmapWriteService(repository);
    const roadmap = await service.updateFeature("owner-a", "cf-002", {
      component: "Roller",
      priority: "High",
      status: "Building",
      title: "Updated title",
    });
    expect(roadmap.features.find((item) => item.featureId === "CF-002")).toEqual(
      expect.objectContaining({
        component: "Roller",
        componentId: componentB,
        priority: "High",
        status: "Building",
        title: "Updated title",
      }),
    );
    await expect(service.updateFeature("other-owner", "CF-002", { priority: "Low" }))
      .rejects.toMatchObject({ code: "feature_not_found" });
  });

  it("reorders through the canonical global sequence and preserves other relative order", async () => {
    const service = new RoadmapWriteService(repositoryFixture());
    const roadmap = await service.reorderFeature("owner-a", "CF-003", 1);
    expect(roadmap.globalSequence).toEqual(["CF-003", "CF-001", "CF-002"]);
    expect(roadmap.features.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  it("adds and removes valid dependencies while rejecting missing, self, and duplicate references", async () => {
    const service = new RoadmapWriteService(repositoryFixture());
    const added = await service.addDependency("owner-a", "CF-002", "CF-001");
    expect(added.features.find((item) => item.featureId === "CF-002")?.dependencies)
      .toEqual([{ featureId: "CF-001", id: ids[0], title: "Feature 1" }]);
    await expect(service.addDependency("owner-a", "CF-002", "CF-001"))
      .rejects.toMatchObject({ code: "dependency_duplicate" });
    await expect(service.addDependency("owner-a", "CF-002", "CF-002"))
      .rejects.toMatchObject({ code: "dependency_self" });
    await expect(service.addDependency("owner-a", "CF-002", "CF-999"))
      .rejects.toMatchObject({ code: "feature_not_found" });
    const removed = await service.removeDependency("owner-a", "CF-002", "CF-001");
    expect(removed.features.find((item) => item.featureId === "CF-002")?.dependencies).toEqual([]);
  });

  it("appends Notes with a preserved paragraph break and never replaces existing text", async () => {
    const service = new RoadmapWriteService(repositoryFixture());
    const roadmap = await service.appendNotes("owner-a", "CF-002", "New paragraph.\nSecond line.");
    expect(roadmap.features.find((item) => item.featureId === "CF-002")?.notes)
      .toBe("Existing paragraph.\n\nNew paragraph.\nSecond line.");
    await expect(service.appendNotes("owner-a", "CF-002", "   "))
      .rejects.toBeInstanceOf(RoadmapWriteError);
  });
});
