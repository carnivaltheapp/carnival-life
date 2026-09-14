import "server-only";

import type { Collection } from "mongodb";

import {
  branchTreeSummary,
  buildBranchTree,
  flattenBranchTree,
  type TreeOfLifeBranchRecord,
} from "../../domain/tree-of-life";
import { getCarnivalMongoDatabase } from "../playhouse/mongo-client";

const COLLECTION_NAME = "tree_of_life";

type TreeOfLifeDocument = {
  owner_user_id: string;
  name: string;
  relative_path: string;
  parent_relative_path: string | null;
  depth: number;
  selectable: boolean;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

type BranchCollection = Collection<TreeOfLifeDocument>;

declare global {
  var carnivalTreeOfLifeIndexPromise: Promise<unknown> | undefined;
}

async function defaultCollection() {
  const collection = (await getCarnivalMongoDatabase())
    .collection<TreeOfLifeDocument>(COLLECTION_NAME);
  globalThis.carnivalTreeOfLifeIndexPromise ??= Promise.all([
    collection.createIndex(
      { owner_user_id: 1, relative_path: 1 },
      { name: "owner_relative_path_unique", unique: true },
    ),
    collection.createIndex(
      { owner_user_id: 1, active: 1, relative_path: 1 },
      { name: "owner_active_relative_path" },
    ),
  ]);
  await globalThis.carnivalTreeOfLifeIndexPromise;
  return collection;
}

function toRecord(document: TreeOfLifeDocument): TreeOfLifeBranchRecord {
  return {
    active: document.active,
    depth: document.depth,
    name: document.name,
    parentRelativePath: document.parent_relative_path,
    relativePath: document.relative_path,
    selectable: document.selectable,
  };
}

export class MongoTreeOfLifeRepository {
  constructor(private readonly collection: () => Promise<BranchCollection> = defaultCollection) {}

  async listBranchesForOwner(ownerUserId: string) {
    const documents = await (await this.collection()).find(
      { active: true, owner_user_id: ownerUserId },
      { projection: { _id: 0 } },
    ).sort({ relative_path: 1 }).toArray();
    return documents.map(toRecord);
  }

  async getBranchTreeForOwner(ownerUserId: string) {
    return buildBranchTree(await this.listBranchesForOwner(ownerUserId));
  }

  async upsertBootstrapTree(ownerUserId: string, tree: unknown) {
    const collection = await this.collection();
    const existingCount = await collection.countDocuments({ owner_user_id: ownerUserId });
    if (existingCount > 0) {
      const existing = await this.listBranchesForOwner(ownerUserId);
      return { initialized: false as const, ...branchTreeSummary(existing) };
    }

    const records = flattenBranchTree(tree);
    if (!records.length) throw new Error("Branch tree is empty.");
    const now = new Date();
    await collection.bulkWrite(records.map((record) => ({
      updateOne: {
        filter: { owner_user_id: ownerUserId, relative_path: record.relativePath },
        update: {
          $set: {
            active: record.active,
            depth: record.depth,
            name: record.name,
            parent_relative_path: record.parentRelativePath,
            selectable: record.selectable,
            updated_at: now,
          },
          $setOnInsert: {
            created_at: now,
            owner_user_id: ownerUserId,
            relative_path: record.relativePath,
          },
        },
        upsert: true,
      },
    })), { ordered: true });
    return { initialized: true as const, ...branchTreeSummary(records) };
  }
}

export { COLLECTION_NAME as TREE_OF_LIFE_COLLECTION_NAME };
