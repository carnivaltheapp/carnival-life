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
  runTransaction,
}: {
  components?: Record<string, unknown>;
  features?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  runTransaction?: (operation: (session: unknown) => Promise<unknown>) => Promise<unknown>;
}) {
  return new MongoDevelopmentFeatureRepository(async () => ({
    components,
    features,
    meta,
    runTransaction,
  }) as never);
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
      human_feature_id: "CF-002",
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
    const meta = {
      findOne: vi.fn().mockResolvedValue({ feature_reference_seed_version: 1 }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ last_feature_number: 3 }),
    };
    const repository = repositoryWith({ components, features, meta });
    await expect(repository.create("owner-a", input)).resolves.toEqual(expect.objectContaining({
      component: "PlayHouse",
      componentId,
      featureId: "CF-003",
    }));
    expect(features.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      component: "PlayHouse",
      component_id: componentId,
      human_feature_id: "CF-003",
      owner_user_id: "owner-a",
    }));
    await expect(repository.update("owner-a", persisted.feature_id, input)).resolves
      .toEqual(expect.objectContaining({ featureId: "CF-002" }));
    expect(features.findOneAndUpdate).toHaveBeenCalledWith(
      { feature_id: persisted.feature_id, owner_user_id: "owner-a" },
      { $set: expect.objectContaining({ component: "PlayHouse", component_id: componentId }) },
      { returnDocument: "after" },
    );
    expect(vi.mocked(features.findOneAndUpdate).mock.calls[0][1].$set)
      .not.toHaveProperty("human_feature_id");
  });

  it("assigns existing feature references deterministically without changing sequence", async () => {
    const features = {
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([
        {
          created_at: new Date("2026-09-24T11:00:00.000Z"),
          feature_id: "205d0598-b93c-49e1-aec3-4dac945e6e0a",
          sequence: 1,
        },
        {
          created_at: new Date("2026-09-24T10:00:00.000Z"),
          feature_id: "34a28cb5-e40d-4da5-98b3-69d8de358c4d",
          sequence: 9,
        },
      ]) })),
    };
    const meta = {
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    await repositoryWith({ features, meta }).ensureFeatureReferences("owner-a");
    expect(features.bulkWrite).toHaveBeenCalledWith([
      { updateOne: {
        filter: { feature_id: "34a28cb5-e40d-4da5-98b3-69d8de358c4d", owner_user_id: "owner-a" },
        update: { $set: { human_feature_id: "CF-001" } },
      } },
      { updateOne: {
        filter: { feature_id: "205d0598-b93c-49e1-aec3-4dac945e6e0a", owner_user_id: "owner-a" },
        update: { $set: { human_feature_id: "CF-002" } },
      } },
    ], { ordered: true, session: undefined });
    expect(meta.updateOne).toHaveBeenCalledWith(
      { owner_user_id: "owner-a" },
      { $set: expect.objectContaining({ last_feature_number: 2 }) },
      { session: undefined, upsert: true },
    );
  });

  it("completes an already-seeded feature-reference check through the transaction wrapper", async () => {
    const meta = {
      findOne: vi.fn().mockResolvedValue({ feature_reference_seed_version: 1 }),
    };
    const runTransaction = vi.fn(async (operation: (session: unknown) => Promise<unknown>) => {
      const result = await operation({});
      if (result === undefined) throw new Error("Development transaction produced no result.");
      return result;
    });
    const repository = repositoryWith({ meta, runTransaction });

    await expect(repository.ensureFeatureReferences("owner-a")).resolves.toBeUndefined();
    expect(runTransaction).toHaveBeenCalledOnce();
    expect(meta.findOne).toHaveBeenCalledWith(
      {
        feature_reference_seed_version: { $gte: 1 },
        owner_user_id: "owner-a",
      },
      { session: {} },
    );
  });

  it("saves, retrieves, and edits a long Notes string without truncation", async () => {
    const longNotes = `Product documentation\n\n${"Detailed implementation context.\n".repeat(400)}`;
    const editedNotes = `${longNotes}\nFinal edited paragraph.`;
    expect(longNotes.length).toBeGreaterThan(10_000);
    const now = new Date("2026-09-24T12:00:00.000Z");
    const persisted = (notes: string) => ({
      component: "PlayHouse",
      component_id: componentId,
      created_at: now,
      dependencies: [],
      description: input.description,
      feature_id: input.dependencies[0],
      human_feature_id: "CF-025",
      is_demo: false,
      notes,
      owner_user_id: "owner-a",
      priority: input.priority,
      sequence: input.sequence,
      status: input.status,
      title: input.title,
      updated_at: now,
    });
    const components = { findOne: vi.fn().mockResolvedValue(componentDocument) };
    const features = {
      findOne: vi.fn().mockResolvedValue(persisted(longNotes)),
      findOneAndUpdate: vi.fn().mockResolvedValue(persisted(editedNotes)),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const meta = {
      findOne: vi.fn().mockResolvedValue({ feature_reference_seed_version: 1 }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ last_feature_number: 25 }),
    };
    const repository = repositoryWith({ components, features, meta });
    await expect(repository.create("owner-a", { ...input, dependencies: [], notes: longNotes }))
      .resolves.toEqual(expect.objectContaining({ notes: longNotes }));
    expect(features.insertOne).toHaveBeenCalledWith(expect.objectContaining({ notes: longNotes }));
    await expect(repository.get("owner-a", input.dependencies[0])).resolves
      .toEqual(expect.objectContaining({ notes: longNotes }));
    await expect(repository.update("owner-a", input.dependencies[0], {
      ...input,
      dependencies: [],
      notes: editedNotes,
    })).resolves.toEqual(expect.objectContaining({ notes: editedNotes }));
    expect(features.findOneAndUpdate).toHaveBeenCalledWith(
      { feature_id: input.dependencies[0], owner_user_id: "owner-a" },
      { $set: expect.objectContaining({ notes: editedNotes }) },
      { returnDocument: "after" },
    );
  });

  it("atomically allocates unique never-reused feature references", async () => {
    const inserted: Array<{ human_feature_id?: string }> = [];
    const features = {
      insertOne: vi.fn(async (document: { human_feature_id?: string }) => {
        inserted.push(document);
        return { acknowledged: true };
      }),
    };
    const components = { findOne: vi.fn().mockResolvedValue(componentDocument) };
    const meta = {
      findOne: vi.fn().mockResolvedValue({ feature_reference_seed_version: 1 }),
      findOneAndUpdate: vi.fn()
        .mockResolvedValueOnce({ last_feature_number: 18 })
        .mockResolvedValueOnce({ last_feature_number: 19 }),
    };
    const repository = repositoryWith({ components, features, meta });
    const created = await Promise.all([
      repository.create("owner-a", input),
      repository.create("owner-a", { ...input, title: "Concurrent feature" }),
    ]);
    expect(created.map((feature) => feature?.featureId)).toEqual(["CF-018", "CF-019"]);
    expect(new Set(inserted.map((document) => document.human_feature_id)).size).toBe(2);
    expect(meta.findOneAndUpdate).toHaveBeenCalledTimes(2);
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
      human_feature_id: "CF-004",
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
      featureId: "CF-004",
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
    expect(vi.mocked(features.findOneAndUpdate).mock.calls[0][1].$set)
      .not.toHaveProperty("human_feature_id");
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

  it("never reuses a deleted feature reference", async () => {
    const features = {
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    };
    const components = { findOne: vi.fn().mockResolvedValue(componentDocument) };
    const meta = {
      findOne: vi.fn().mockResolvedValue({ feature_reference_seed_version: 1 }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ last_feature_number: 21 }),
    };
    const repository = repositoryWith({ components, features, meta });
    await expect(repository.delete("owner-a", input.dependencies[0])).resolves.toBe(true);
    await expect(repository.create("owner-a", input)).resolves
      .toEqual(expect.objectContaining({ featureId: "CF-021" }));
    expect(meta.findOneAndUpdate).toHaveBeenCalledOnce();
  });

  it("fails machine roadmap owner resolution closed when owners are ambiguous", async () => {
    const meta = { distinct: vi.fn().mockResolvedValue(["owner-a", "owner-b"]) };
    await expect(repositoryWith({ meta }).machineRoadmapOwner()).resolves.toBeNull();
    meta.distinct.mockResolvedValue(["owner-a"]);
    await expect(repositoryWith({ meta }).machineRoadmapOwner()).resolves.toBe("owner-a");
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
