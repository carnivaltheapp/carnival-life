import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEVELOPMENT_DEMO_FEATURES } from "./seed";
import { MongoDevelopmentFeatureRepository } from "./repository";

const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");

function repositoryWith(features: Record<string, unknown>, meta: Record<string, unknown> = {}) {
  return new MongoDevelopmentFeatureRepository(async () => ({ features, meta }) as never);
}

const input = {
  component: "PlayHouse" as const,
  dependencies: ["34a28cb5-e40d-4da5-98b3-69d8de358c4d"],
  description: "Description",
  notes: "Notes",
  priority: "Medium" as const,
  sequence: 3,
  status: "Planned" as const,
  title: "Feature",
};

describe("Mongo Development feature repository", () => {
  it("defines owner-scoped identity, sequence, and combined-filter indexes", () => {
    expect(source).toContain('{ owner_user_id: 1, feature_id: 1 }');
    expect(source).toContain('{ name: "owner_feature_unique", unique: true }');
    expect(source).toContain('{ owner_user_id: 1, sequence: 1, created_at: 1 }');
    expect(source).toContain('{ owner_user_id: 1, component: 1, status: 1, priority: 1 }');
  });

  it("seeds clearly identified demo records only once for an owner", async () => {
    const features = { bulkWrite: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const meta = {
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    await repositoryWith(features, meta).ensureDemoSeed("owner-a");
    expect(features.bulkWrite).toHaveBeenCalledOnce();
    expect(vi.mocked(features.bulkWrite).mock.calls[0][0]).toHaveLength(DEVELOPMENT_DEMO_FEATURES.length);
    expect(vi.mocked(features.bulkWrite).mock.calls[0][0][0]).toMatchObject({ updateOne: {
      filter: { feature_id: DEVELOPMENT_DEMO_FEATURES[0].id, owner_user_id: "owner-a" },
      update: { $setOnInsert: { is_demo: true, owner_user_id: "owner-a" } },
      upsert: true,
    } });
    expect(meta.updateOne).toHaveBeenCalledWith(
      { owner_user_id: "owner-a" },
      { $set: expect.objectContaining({ demo_seed_version: 1, owner_user_id: "owner-a" }) },
      { upsert: true },
    );
  });

  it("creates, updates, and deletes only within the authenticated owner scope", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const persisted = {
      ...input,
      created_at: now,
      feature_id: "34a28cb5-e40d-4da5-98b3-69d8de358c4d",
      is_demo: false,
      owner_user_id: "owner-a",
      updated_at: now,
    };
    const features = {
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      findOneAndUpdate: vi.fn().mockResolvedValue(persisted),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const repository = repositoryWith(features);
    await repository.create("owner-a", input);
    expect(features.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      dependencies: input.dependencies,
      owner_user_id: "owner-a",
      sequence: 3,
    }));
    await expect(repository.update("owner-a", persisted.feature_id, input)).resolves.toEqual(
      expect.objectContaining({ dependencies: input.dependencies, sequence: 3 }),
    );
    expect(features.findOneAndUpdate).toHaveBeenCalledWith(
      { feature_id: persisted.feature_id, owner_user_id: "owner-a" },
      { $set: expect.objectContaining(input) },
      { returnDocument: "after" },
    );
    await expect(repository.delete("owner-a", persisted.feature_id)).resolves.toBe(true);
    expect(features.deleteOne).toHaveBeenCalledWith({
      feature_id: persisted.feature_id,
      owner_user_id: "owner-a",
    });
    expect(features.updateMany).toHaveBeenCalledWith(
      { dependencies: persisted.feature_id, owner_user_id: "owner-a" },
      expect.objectContaining({ $pull: { dependencies: persisted.feature_id } }),
    );
  });

  it("requires every dependency to exist for the same owner and rejects self-dependency", async () => {
    const countDocuments = vi.fn().mockResolvedValue(1);
    const repository = repositoryWith({ countDocuments });
    await expect(repository.dependenciesExist("owner-a", input.dependencies)).resolves.toBe(true);
    expect(countDocuments).toHaveBeenCalledWith({
      feature_id: { $in: input.dependencies },
      owner_user_id: "owner-a",
    });
    await expect(repository.dependenciesExist(
      "owner-a",
      input.dependencies,
      input.dependencies[0],
    )).resolves.toBe(false);
  });
});
