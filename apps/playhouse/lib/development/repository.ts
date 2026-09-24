import "server-only";

import { randomUUID } from "node:crypto";
import type { Collection } from "mongodb";

import type {
  DevelopmentFeature,
  DevelopmentFeatureInput,
} from "../../domain/development-feature";
import { getCarnivalMongoDatabase } from "../playhouse/mongo-client";
import { DEVELOPMENT_DEMO_FEATURES, DEVELOPMENT_DEMO_SEED_VERSION } from "./seed";

const FEATURE_COLLECTION = "carnival_development_features";
const META_COLLECTION = "carnival_development_console_meta";

type DevelopmentFeatureDocument = {
  component: DevelopmentFeature["component"];
  created_at: Date;
  dependencies: string[];
  description: string;
  feature_id: string;
  is_demo: boolean;
  notes: string;
  owner_user_id: string;
  priority: DevelopmentFeature["priority"];
  sequence: number | null;
  status: DevelopmentFeature["status"];
  title: string;
  updated_at: Date;
};

type DevelopmentConsoleMetaDocument = {
  demo_seed_version: number;
  demo_seeded_at: Date;
  owner_user_id: string;
};

type Collections = {
  features: Collection<DevelopmentFeatureDocument>;
  meta: Collection<DevelopmentConsoleMetaDocument>;
};

declare global {
  var carnivalDevelopmentIndexesPromise: Promise<unknown> | undefined;
}

async function defaultCollections(): Promise<Collections> {
  const database = await getCarnivalMongoDatabase();
  const features = database.collection<DevelopmentFeatureDocument>(FEATURE_COLLECTION);
  const meta = database.collection<DevelopmentConsoleMetaDocument>(META_COLLECTION);
  globalThis.carnivalDevelopmentIndexesPromise ??= Promise.all([
    features.createIndex(
      { owner_user_id: 1, feature_id: 1 },
      { name: "owner_feature_unique", unique: true },
    ),
    features.createIndex(
      { owner_user_id: 1, sequence: 1, created_at: 1 },
      { name: "owner_sequence" },
    ),
    features.createIndex(
      { owner_user_id: 1, component: 1, status: 1, priority: 1 },
      { name: "owner_filters" },
    ),
    meta.createIndex(
      { owner_user_id: 1 },
      { name: "owner_meta_unique", unique: true },
    ),
  ]);
  await globalThis.carnivalDevelopmentIndexesPromise;
  return { features, meta };
}

function publicFeature(document: DevelopmentFeatureDocument): DevelopmentFeature {
  return {
    component: document.component,
    createdAt: document.created_at.toISOString(),
    dependencies: document.dependencies,
    description: document.description,
    id: document.feature_id,
    notes: document.notes,
    priority: document.priority,
    sequence: document.sequence,
    status: document.status,
    title: document.title,
    updatedAt: document.updated_at.toISOString(),
  };
}

export class MongoDevelopmentFeatureRepository {
  constructor(private readonly collections: () => Promise<Collections> = defaultCollections) {}

  async ensureDemoSeed(ownerUserId: string) {
    const { features, meta } = await this.collections();
    const seeded = await meta.findOne({
      demo_seed_version: { $gte: DEVELOPMENT_DEMO_SEED_VERSION },
      owner_user_id: ownerUserId,
    });
    if (seeded) return;
    const now = new Date();
    await features.bulkWrite(DEVELOPMENT_DEMO_FEATURES.map((feature) => ({
      updateOne: {
        filter: { feature_id: feature.id, owner_user_id: ownerUserId },
        update: { $setOnInsert: {
          component: feature.component,
          created_at: now,
          dependencies: feature.dependencies,
          description: feature.description,
          feature_id: feature.id,
          is_demo: true,
          notes: feature.notes,
          owner_user_id: ownerUserId,
          priority: feature.priority,
          sequence: feature.sequence,
          status: feature.status,
          title: feature.title,
          updated_at: now,
        } },
        upsert: true,
      },
    })));
    await meta.updateOne(
      { owner_user_id: ownerUserId },
      { $set: {
        demo_seed_version: DEVELOPMENT_DEMO_SEED_VERSION,
        demo_seeded_at: now,
        owner_user_id: ownerUserId,
      } },
      { upsert: true },
    );
  }

  async list(ownerUserId: string) {
    const documents = await (await this.collections()).features.find(
      { owner_user_id: ownerUserId },
      { projection: { _id: 0, owner_user_id: 0 } },
    ).sort({ sequence: 1, created_at: 1 }).toArray();
    return documents.map(publicFeature);
  }

  async get(ownerUserId: string, featureId: string) {
    const document = await (await this.collections()).features.findOne(
      { feature_id: featureId, owner_user_id: ownerUserId },
      { projection: { _id: 0, owner_user_id: 0 } },
    );
    return document ? publicFeature(document) : null;
  }

  async dependenciesExist(ownerUserId: string, dependencies: string[], featureId?: string) {
    if (featureId && dependencies.includes(featureId)) return false;
    if (dependencies.length === 0) return true;
    const count = await (await this.collections()).features.countDocuments({
      feature_id: { $in: dependencies },
      owner_user_id: ownerUserId,
    });
    return count === dependencies.length;
  }

  async create(ownerUserId: string, input: DevelopmentFeatureInput) {
    const now = new Date();
    const document: DevelopmentFeatureDocument = {
      ...input,
      created_at: now,
      feature_id: randomUUID(),
      is_demo: false,
      owner_user_id: ownerUserId,
      updated_at: now,
    };
    await (await this.collections()).features.insertOne(document);
    return publicFeature(document);
  }

  async update(ownerUserId: string, featureId: string, input: DevelopmentFeatureInput) {
    const document = await (await this.collections()).features.findOneAndUpdate(
      { feature_id: featureId, owner_user_id: ownerUserId },
      { $set: { ...input, updated_at: new Date() } },
      { returnDocument: "after" },
    );
    return document ? publicFeature(document) : null;
  }

  async delete(ownerUserId: string, featureId: string) {
    const { features } = await this.collections();
    const result = await features.deleteOne({
      feature_id: featureId,
      owner_user_id: ownerUserId,
    });
    if (result.deletedCount === 0) return false;
    await features.updateMany(
      { dependencies: featureId, owner_user_id: ownerUserId },
      { $pull: { dependencies: featureId }, $set: { updated_at: new Date() } },
    );
    return true;
  }
}

export const DEVELOPMENT_FEATURE_COLLECTION = FEATURE_COLLECTION;
export const DEVELOPMENT_CONSOLE_META_COLLECTION = META_COLLECTION;
