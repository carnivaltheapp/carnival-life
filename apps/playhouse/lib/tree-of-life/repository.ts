import "server-only";

import type { Collection } from "mongodb";

import { exactDriveFolderUrl, type DriveFolderIdentity } from "../../domain/tree-of-life-drive";
import {
  branchTreeSummary,
  branchTreeFromFolders,
  buildFolderTree,
  flattenBranchTree,
  parseFolderImage,
  type TreeOfLifeFolderRecord,
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
  drive_folder_id?: string | null;
  drive_web_url?: string | null;
  selectable: boolean;
  is_branch?: boolean;
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

function toFolderRecord(document: TreeOfLifeDocument): TreeOfLifeFolderRecord {
  return {
    active: document.active,
    depth: document.depth,
    isBranch: document.is_branch ?? document.selectable,
    name: document.name,
    parentRelativePath: document.parent_relative_path,
    relativePath: document.relative_path,
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

  async listAllFoldersForOwner(ownerUserId: string) {
    const documents = await (await this.collection()).find(
      { active: true, owner_user_id: ownerUserId },
      { projection: { _id: 0 } },
    ).sort({ relative_path: 1 }).toArray();
    return documents.map(toFolderRecord);
  }

  async getFolderTreeForOwner(ownerUserId: string) {
    return buildFolderTree(await this.listAllFoldersForOwner(ownerUserId));
  }

  async resolveDriveFolderForOwner(ownerUserId: string, relativePath: string) {
    const record = parseFolderImage([{ name: relativePath.replaceAll("\\", "/").split("/").at(-1), relativePath }])[0];
    const document = await (await this.collection()).findOne(
      { active: true, owner_user_id: ownerUserId, relative_path: record.relativePath },
      { projection: { _id: 0, drive_folder_id: 1, drive_web_url: 1 } },
    );
    return document ? exactDriveFolderUrl({
      driveFolderId: document.drive_folder_id,
      driveWebUrl: document.drive_web_url,
    }) : null;
  }

  async setDriveFolderIdentity(
    ownerUserId: string,
    relativePath: string,
    identity: DriveFolderIdentity,
  ) {
    const record = parseFolderImage([{ name: relativePath.replaceAll("\\", "/").split("/").at(-1), relativePath }])[0];
    const url = exactDriveFolderUrl(identity);
    if (!url) throw new Error("An exact Google Drive folder identity is required.");
    return (await (await this.collection()).updateOne(
      { active: true, owner_user_id: ownerUserId, relative_path: record.relativePath },
      { $set: {
        drive_folder_id: identity.driveFolderId?.trim() || null,
        drive_web_url: url,
        updated_at: new Date(),
      } },
    )).matchedCount === 1;
  }

  async searchFoldersForOwner(ownerUserId: string, query: string) {
    const normalized = query.trim().toLocaleLowerCase();
    const folders = await this.listAllFoldersForOwner(ownerUserId);
    return normalized
      ? folders.filter((folder) => folder.relativePath.toLocaleLowerCase().includes(normalized))
      : folders;
  }

  async getBranchTreeForOwner(ownerUserId: string) {
    const folders = await this.listAllFoldersForOwner(ownerUserId);
    return branchTreeFromFolders(buildFolderTree(folders));
  }

  async reconcileFolders(ownerUserId: string, image: unknown) {
    const records = parseFolderImage(image);
    const collection = await this.collection();
    const now = new Date();
    if (records.length) {
      await collection.bulkWrite(records.map((record) => ({
        updateOne: {
          filter: { owner_user_id: ownerUserId, relative_path: record.relativePath },
          update: {
            $set: {
              active: true,
              depth: record.depth,
              name: record.name,
              parent_relative_path: record.parentRelativePath,
              updated_at: now,
            },
            $setOnInsert: {
              created_at: now,
              is_branch: record.isBranch,
              owner_user_id: ownerUserId,
              relative_path: record.relativePath,
              selectable: record.isBranch,
            },
          },
          upsert: true,
        },
      })), { ordered: false });
    }
    await collection.updateMany(
      { owner_user_id: ownerUserId, relative_path: { $nin: records.map((record) => record.relativePath) } },
      { $set: { active: false, updated_at: now } },
    );
    return { branchCount: records.filter((record) => record.isBranch).length, folderCount: records.length };
  }

  async applyFolderEvent(ownerUserId: string, event: {
    kind: "folder_created" | "folder_deleted" | "folder_moved" | "folder_renamed";
    name?: string;
    oldRelativePath?: string;
    relativePath: string;
  }) {
    const collection = await this.collection();
    const now = new Date();
    if (event.kind === "folder_deleted") {
      const escaped = event.relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await collection.updateMany(
        { owner_user_id: ownerUserId, relative_path: { $regex: `^${escaped}(?:/|$)` } },
        { $set: { active: false, updated_at: now } },
      );
      return;
    }
    if ((event.kind === "folder_moved" || event.kind === "folder_renamed") && event.oldRelativePath) {
      const escaped = event.oldRelativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const documents = await collection.find({
        owner_user_id: ownerUserId,
        relative_path: { $regex: `^${escaped}(?:/|$)` },
      }).toArray();
      if (documents.length) await collection.bulkWrite(documents.map((document) => {
        const relativePath = event.relativePath + document.relative_path.slice(event.oldRelativePath!.length);
        const parts = relativePath.split("/");
        return { updateOne: {
          filter: { owner_user_id: ownerUserId, relative_path: document.relative_path },
          update: { $set: {
            active: true,
            depth: parts.length - 1,
            name: parts.at(-1)!,
            parent_relative_path: parts.length > 1 ? parts.slice(0, -1).join("/") : null,
            relative_path: relativePath,
            updated_at: now,
          } },
        } };
      }), { ordered: true });
      return;
    }
    const record = parseFolderImage([{ name: event.name, relativePath: event.relativePath }])[0];
    await collection.updateOne(
      { owner_user_id: ownerUserId, relative_path: record.relativePath },
      { $set: {
        active: true,
        depth: record.depth,
        name: record.name,
        parent_relative_path: record.parentRelativePath,
        updated_at: now,
      }, $setOnInsert: {
        created_at: now,
        is_branch: false,
        owner_user_id: ownerUserId,
        selectable: false,
      } },
      { upsert: true },
    );
  }

  async setBranchState(ownerUserId: string, relativePath: string, isBranch: boolean) {
    const record = parseFolderImage([{
      name: relativePath.replaceAll("\\", "/").split("/").at(-1),
      relativePath,
    }])[0];
    return (await (await this.collection()).updateOne(
      { active: true, owner_user_id: ownerUserId, relative_path: record.relativePath },
      { $set: { is_branch: isBranch, selectable: isBranch, updated_at: new Date() } },
    )).matchedCount === 1;
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
