import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_DEVELOPMENT_COMPONENTS } from "./seed";
import { MongoDevelopmentFeatureRepository } from "./repository";

const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
const componentId = DEFAULT_DEVELOPMENT_COMPONENTS[0].id;

function repositoryWith({
  components = {},
  features = {},
  meta = {},
}: {
  components?: Record<string, unknown>;
  features?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}) {
  return new MongoDevelopmentFeatureRepository(async () => ({ components, features, meta }) as never);
}

const input = {
  componentId,
  dependencies: ["34a28cb5-e40d-4da5-98b3-69d8de358c4d"],
  description: "Description",
  notes: "Notes",
  priority: "Medium" as const,
  sequence: 3,
  status: "Planned" as const,
  title: "Feature",
};

const componentDocument = {
  component_id: componentId,
  created_at: new Date("2026-09-24T12:00:00.000Z"),
  hidden: false,
  icon: "house" as const,
  name: "PlayHouse",
  name_key: "playhouse",
  owner_user_id: "owner-a",
  sort_order: 0,
  updated_at: new Date("2026-09-24T12:00:00.000Z"),
};

describe("Mongo Development Console repository", () => {
  it("defines owner-scoped component identity, name, order, and feature relationship indexes", () => {
    expect(source).toContain('{ owner_user_id: 1, component_id: 1 }');
    expect(source).toContain('{ name: "owner_component_unique", unique: true }');
    expect(source).toContain('{ owner_user_id: 1, name_key: 1 }');
    expect(source).toContain('{ name: "owner_component_name_unique", unique: true }');
    expect(source).toContain('{ owner_user_id: 1, sort_order: 1 }');
    expect(source).toContain('{ owner_user_id: 1, component_id: 1, status: 1, priority: 1 }');
    expect(source).toContain("session.withTransaction");
  });

  it("seeds the marker-134 component order and backfills legacy name-only features", async () => {
    const components = { bulkWrite: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const features = { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }) };
    const meta = {
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    await repositoryWith({ components, features, meta }).ensureComponentSeed("owner-a");
    expect(components.bulkWrite).toHaveBeenCalledOnce();
    expect(vi.mocked(components.bulkWrite).mock.calls[0][0]).toHaveLength(DEFAULT_DEVELOPMENT_COMPONENTS.length);
    expect(features.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ component: "PlayHouse", owner_user_id: "owner-a" }),
      { $set: { component_id: componentId } },
    );
    expect(meta.updateOne).toHaveBeenCalledWith(
      { owner_user_id: "owner-a" },
      { $set: expect.objectContaining({ component_seed_version: 1 }) },
      { upsert: true },
    );
  });

  it("creates and updates features with the stable component ID and compatibility name", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const persisted = {
      component: "PlayHouse",
      component_id: componentId,
      created_at: now,
      dependencies: input.dependencies,
      description: input.description,
      feature_id: "34a28cb5-e40d-4da5-98b3-69d8de358c4d",
      is_demo: false,
      notes: input.notes,
      owner_user_id: "owner-a",
      priority: input.priority,
      sequence: input.sequence,
      status: input.status,
      title: input.title,
      updated_at: now,
    };
    const components = { findOne: vi.fn().mockResolvedValue(componentDocument) };
    const features = {
      findOneAndUpdate: vi.fn().mockResolvedValue(persisted),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const repository = repositoryWith({ components, features });
    await expect(repository.create("owner-a", input)).resolves.toEqual(expect.objectContaining({
      component: "PlayHouse",
      componentId,
    }));
    expect(features.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      component: "PlayHouse",
      component_id: componentId,
      owner_user_id: "owner-a",
    }));
    await repository.update("owner-a", persisted.feature_id, input);
    expect(features.findOneAndUpdate).toHaveBeenCalledWith(
      { feature_id: persisted.feature_id, owner_user_id: "owner-a" },
      { $set: expect.objectContaining({ component: "PlayHouse", component_id: componentId }) },
      { returnDocument: "after" },
    );
  });

  it("persists a complete global feature sequence with owner-scoped bulk updates", async () => {
    const secondId = "205d0598-b93c-49e1-aec3-4dac945e6e0a";
    const features = {
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([
        { feature_id: input.dependencies[0] },
        { feature_id: secondId },
      ]) })),
    };
    await expect(repositoryWith({ features }).reorderFeatures(
      "owner-a",
      [secondId, input.dependencies[0]],
    )).resolves.toBe(true);
    expect(features.bulkWrite).toHaveBeenCalledWith([
      { updateOne: {
        filter: { feature_id: secondId, owner_user_id: "owner-a" },
        update: { $set: expect.objectContaining({ sequence: 1 }) },
      } },
      { updateOne: {
        filter: { feature_id: input.dependencies[0], owner_user_id: "owner-a" },
        update: { $set: expect.objectContaining({ sequence: 2 }) },
      } },
    ], { ordered: true, session: undefined });
  });

  it("rejects a reorder that omits an owner feature", async () => {
    const features = {
      bulkWrite: vi.fn(),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([
        { feature_id: input.dependencies[0] },
        { feature_id: "205d0598-b93c-49e1-aec3-4dac945e6e0a" },
      ]) })),
    };
    await expect(repositoryWith({ features }).reorderFeatures(
      "owner-a",
      [input.dependencies[0]],
    )).resolves.toBe(false);
    expect(features.bulkWrite).not.toHaveBeenCalled();
  });

  it("moves only the targeted owner feature to an existing owner component", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const destination = {
      ...componentDocument,
      component_id: DEFAULT_DEVELOPMENT_COMPONENTS[1].id,
      name: "Roller",
    };
    const persisted = {
      component: "Roller",
      component_id: destination.component_id,
      created_at: now,
      dependencies: [],
      description: "Description",
      feature_id: input.dependencies[0],
      is_demo: false,
      notes: "",
      owner_user_id: "owner-a",
      priority: "High" as const,
      sequence: 4,
      status: "Ready" as const,
      title: "Feature",
      updated_at: now,
    };
    const components = { findOne: vi.fn().mockResolvedValue(destination) };
    const features = { findOneAndUpdate: vi.fn().mockResolvedValue(persisted) };
    await expect(repositoryWith({ components, features }).moveFeatureToComponent(
      "owner-a",
      persisted.feature_id,
      destination.component_id,
    )).resolves.toEqual(expect.objectContaining({
      component: "Roller",
      componentId: destination.component_id,
      priority: "High",
      sequence: 4,
    }));
    expect(features.findOneAndUpdate).toHaveBeenCalledWith(
      { feature_id: persisted.feature_id, owner_user_id: "owner-a" },
      { $set: expect.objectContaining({
        component: "Roller",
        component_id: destination.component_id,
      }) },
      { returnDocument: "after" },
    );
  });

  it("adds, renames, changes icon, and hides a component within owner scope", async () => {
    const components = {
      findOne: vi.fn().mockResolvedValueOnce(componentDocument),
      findOneAndUpdate: vi.fn().mockResolvedValue({
        ...componentDocument,
        hidden: true,
        icon: "sparkles",
        name: "PlayHouse Core",
      }),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const features = { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 }) };
    const repository = repositoryWith({ components, features });
    await repository.createComponent("owner-a", { hidden: false, icon: "grid", name: "New Area" });
    expect(components.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      icon: "grid",
      name: "New Area",
      name_key: "new area",
      owner_user_id: "owner-a",
      sort_order: 1,
    }));
    await expect(repository.updateComponent("owner-a", componentId, {
      hidden: true,
      icon: "sparkles",
      name: "PlayHouse Core",
    })).resolves.toEqual(expect.objectContaining({ hidden: true, icon: "sparkles", name: "PlayHouse Core" }));
    expect(features.updateMany).toHaveBeenCalledWith(
      { component_id: componentId, owner_user_id: "owner-a" },
      { $set: expect.objectContaining({ component: "PlayHouse Core" }) },
    );
  });

  it("persists an exact owner component order", async () => {
    const secondId = DEFAULT_DEVELOPMENT_COMPONENTS[1].id;
    const components = {
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([
        { component_id: componentId },
        { component_id: secondId },
      ]) })),
    };
    await expect(repositoryWith({ components }).reorderComponents(
      "owner-a",
      [secondId, componentId],
    )).resolves.toBe(true);
    expect(components.bulkWrite).toHaveBeenCalledWith([
      { updateOne: { filter: { component_id: secondId, owner_user_id: "owner-a" }, update: { $set: expect.objectContaining({ sort_order: 0 }) } } },
      { updateOne: { filter: { component_id: componentId, owner_user_id: "owner-a" }, update: { $set: expect.objectContaining({ sort_order: 1 }) } } },
    ]);
  });

  it("deletes an empty component but blocks deletion when features would be orphaned", async () => {
    const components = {
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      findOne: vi.fn().mockResolvedValue(componentDocument),
    };
    const emptyFeatures = { countDocuments: vi.fn().mockResolvedValue(0) };
    await expect(repositoryWith({ components, features: emptyFeatures }).deleteComponent(
      "owner-a",
      componentId,
    )).resolves.toEqual({ deleted: true });

    const occupiedFeatures = { countDocuments: vi.fn().mockResolvedValue(3) };
    await expect(repositoryWith({ components, features: occupiedFeatures }).deleteComponent(
      "owner-a",
      componentId,
    )).resolves.toEqual({ deleted: false, featureCount: 3, reason: "component_in_use" });
  });

  it("moves assigned features to an owner component before safe deletion", async () => {
    const destination = {
      ...componentDocument,
      component_id: DEFAULT_DEVELOPMENT_COMPONENTS[1].id,
      name: "Roller",
    };
    const components = {
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      findOne: vi.fn()
        .mockResolvedValueOnce(componentDocument)
        .mockResolvedValueOnce(destination),
    };
    const features = {
      countDocuments: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
    };
    await expect(repositoryWith({ components, features }).deleteComponent(
      "owner-a",
      componentId,
      destination.component_id,
    )).resolves.toEqual({ deleted: true });
    expect(features.updateMany).toHaveBeenCalledWith(
      { component_id: componentId, owner_user_id: "owner-a" },
      { $set: expect.objectContaining({ component: "Roller", component_id: destination.component_id }) },
    );
  });
});
