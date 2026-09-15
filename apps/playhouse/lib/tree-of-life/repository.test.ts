import { readFile } from "node:fs/promises";
import type { Collection } from "mongodb";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MongoTreeOfLifeRepository } from "./repository";

const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");

function repositoryWith(overrides: Record<string, unknown>) {
  const collection = {
    bulkWrite: vi.fn(),
    countDocuments: vi.fn(),
    find: vi.fn(),
    ...overrides,
  } as unknown as Collection<never>;
  return {
    collection,
    repository: new MongoTreeOfLifeRepository(async () => collection as never),
  };
}

const tree = [{
  children: [{ children: [], name: "Marketing", relativePath: "Carnival/Marketing", selectable: true }],
  name: "Carnival",
  relativePath: "Carnival",
  selectable: true,
}];

describe("Mongo Tree of Life repository", () => {
  it("defines unique owner/relative-path and indexed active-owner reads", () => {
    expect(source).toContain('{ owner_user_id: 1, relative_path: 1 }');
    expect(source).toContain('{ name: "owner_relative_path_unique", unique: true }');
    expect(source).toContain('{ owner_user_id: 1, active: 1, relative_path: 1 }');
  });

  it("uses one active owner-scoped read and cannot expose another owner's records", async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const sort = vi.fn(() => ({ toArray }));
    const { collection, repository } = repositoryWith({ find: vi.fn(() => ({ sort })) });
    await repository.listBranchesForOwner("owner-a");
    expect(collection.find).toHaveBeenCalledWith(
      { active: true, owner_user_id: "owner-a" },
      { projection: { _id: 0 } },
    );
    expect(sort).toHaveBeenCalledWith({ relative_path: 1 });
  });

  it("returns ordinary leaf folders from the all-folder path while keeping the Branch path filtered", async () => {
    const branchNames = new Set(["0-Recruiting", "1-Customers", "Marketing", "Operations"]);
    const names = [
      "0-Recruiting", "1-Customers", "2-Providers", "3-Affiliates", "5-Partners",
      "Access", "Docs", "Elastic AI", "ElasticList", "LLC", "Marketing", "Old",
      "Operations", "Players", "SuperDrive",
    ];
    const documents = ["Elastic Teams", ...names].map((name, index) => ({
      active: true,
      created_at: new Date(),
      depth: index ? 1 : 0,
      is_branch: index ? branchNames.has(name) : false,
      name,
      owner_user_id: "owner-a",
      parent_relative_path: index ? "Elastic Teams" : null,
      relative_path: index ? `Elastic Teams/${name}` : name,
      selectable: index ? branchNames.has(name) : false,
      updated_at: new Date(),
    }));
    const toArray = vi.fn().mockResolvedValue(documents);
    const sort = vi.fn(() => ({ toArray }));
    const { repository } = repositoryWith({ find: vi.fn(() => ({ sort })) });

    const folders = await repository.getFolderTreeForOwner("owner-a");
    const branches = await repository.getBranchTreeForOwner("owner-a");

    expect(folders[0]?.children).toHaveLength(15);
    expect(folders[0]?.children).toContainEqual(expect.objectContaining({
      children: [],
      isBranch: false,
      name: "SuperDrive",
    }));
    expect(branches[0]?.children.map((branch) => branch.name)).toEqual([
      "0-Recruiting", "1-Customers", "Marketing", "Operations",
    ]);
  });

  it("bootstraps an empty owner with owner/path upserts", async () => {
    const { collection, repository } = repositoryWith({
      bulkWrite: vi.fn().mockResolvedValue({ acknowledged: true }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    await expect(repository.upsertBootstrapTree("owner-a", tree)).resolves.toEqual({
      branchCount: 2,
      initialized: true,
      topLevelCount: 1,
    });
    const writes = vi.mocked(collection.bulkWrite).mock.calls[0][0];
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      updateOne: {
        filter: { owner_user_id: "owner-a", relative_path: "Carnival" },
        upsert: true,
      },
    });
  });

  it("refuses to overwrite an initialized owner", async () => {
    const documents = [{
      active: true,
      created_at: new Date(),
      depth: 0,
      name: "Carnival",
      owner_user_id: "owner-a",
      parent_relative_path: null,
      relative_path: "Carnival",
      selectable: true,
      updated_at: new Date(),
    }];
    const toArray = vi.fn().mockResolvedValue(documents);
    const sort = vi.fn(() => ({ toArray }));
    const { collection, repository } = repositoryWith({
      countDocuments: vi.fn().mockResolvedValue(1),
      find: vi.fn(() => ({ sort })),
    });
    await expect(repository.upsertBootstrapTree("owner-a", tree)).resolves.toEqual({
      branchCount: 1,
      initialized: false,
      topLevelCount: 1,
    });
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it("reconciles filesystem structure without overwriting existing Branch state", async () => {
    const { collection, repository } = repositoryWith({
      bulkWrite: vi.fn().mockResolvedValue({ acknowledged: true }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    });
    await repository.reconcileFolders("owner-a", [
      { isBranch: false, name: "Marketing", relativePath: "Work/Marketing" },
    ]);
    const write = vi.mocked(collection.bulkWrite).mock.calls[0][0][0];
    expect(write).toMatchObject({ updateOne: {
      filter: { owner_user_id: "owner-a", relative_path: "Work/Marketing" },
      update: {
        $set: {
          active: true,
          depth: 1,
          name: "Marketing",
          parent_relative_path: "Work",
        },
        $setOnInsert: { is_branch: false, selectable: false },
      },
    } });
    expect((write as unknown as { updateOne: { update: { $set: object } } }).updateOne.update.$set)
      .not.toHaveProperty("is_branch");
  });
});
