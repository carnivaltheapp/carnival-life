import "server-only";

import { randomUUID } from "node:crypto";
import type { ClientSession, Collection } from "mongodb";

import type { DevelopmentComponentInput } from "../../domain/development-component";
import {
  formatDevelopmentFeatureId,
  normalizeDevelopmentFeatureId,
  type DevelopmentComponentRecord,
  type DevelopmentFeature,
  type DevelopmentFeatureInput,
} from "../../domain/development-feature";
import { getCarnivalMongoClient, getCarnivalMongoDatabase } from "../playhouse/mongo-client";
import {
  DEFAULT_DEVELOPMENT_COMPONENTS,
  DEVELOPMENT_COMPONENT_SEED_VERSION,
  DEVELOPMENT_DEMO_FEATURES,
  DEVELOPMENT_DEMO_SEED_VERSION,
} from "./seed";

const FEATURE_COLLECTION = "carnival_development_features";
const COMPONENT_COLLECTION = "carnival_development_components";
const META_COLLECTION = "carnival_development_console_meta";
const FEATURE_REFERENCE_SEED_VERSION = 1;

type DevelopmentFeatureDocument = {
  component: string;
  component_id?: string;
  created_at: Date;
  dependencies: string[];
  description: string;
  feature_id: string;
  human_feature_id?: string;
  is_demo: boolean;
  notes: string;
  owner_user_id: string;
  priority: DevelopmentFeature["priority"];
  sequence: number | null;
  status: DevelopmentFeature["status"];
  title: string;
  updated_at: Date;
};

type DevelopmentComponentDocument = {
  component_id: string;
  created_at: Date;
  hidden: boolean;
  icon: DevelopmentComponentRecord["icon"];
  name: string;
  name_key: string;
  owner_user_id: string;
  sort_order: number;
  updated_at: Date;
};

type DevelopmentConsoleMetaDocument = {
  component_seed_version?: number;
  components_seeded_at?: Date;
  demo_seed_version?: number;
  demo_seeded_at?: Date;
  feature_reference_seed_version?: number;
  feature_references_seeded_at?: Date;
  last_feature_number?: number;
  owner_user_id: string;
};

type Collections = {
  components: Collection<DevelopmentComponentDocument>;
  features: Collection<DevelopmentFeatureDocument>;
  meta: Collection<DevelopmentConsoleMetaDocument>;
  runTransaction?: <T>(operation: (session: ClientSession) => Promise<T>) => Promise<T>;
};

declare global {
  var carnivalDevelopmentIndexesPromise: Promise<unknown> | undefined;
}

async function defaultCollections(): Promise<Collections> {
  const [client, database] = await Promise.all([
    getCarnivalMongoClient(),
    getCarnivalMongoDatabase(),
  ]);
  const components = database.collection<DevelopmentComponentDocument>(COMPONENT_COLLECTION);
  const features = database.collection<DevelopmentFeatureDocument>(FEATURE_COLLECTION);
  const meta = database.collection<DevelopmentConsoleMetaDocument>(META_COLLECTION);
  globalThis.carnivalDevelopmentIndexesPromise ??= Promise.all([
    features.createIndex(
      { owner_user_id: 1, feature_id: 1 },
      { name: "owner_feature_unique", unique: true },
    ),
    features.createIndex(
      { owner_user_id: 1, human_feature_id: 1 },
      {
        name: "owner_human_feature_unique",
        partialFilterExpression: { human_feature_id: { $type: "string" } },
        unique: true,
      },
    ),
    features.createIndex(
      { owner_user_id: 1, sequence: 1, created_at: 1 },
      { name: "owner_sequence" },
    ),
    features.createIndex(
      { owner_user_id: 1, component_id: 1, status: 1, priority: 1 },
      { name: "owner_component_filters" },
    ),
    components.createIndex(
      { owner_user_id: 1, component_id: 1 },
      { name: "owner_component_unique", unique: true },
    ),
    components.createIndex(
      { owner_user_id: 1, name_key: 1 },
      { name: "owner_component_name_unique", unique: true },
    ),
    components.createIndex(
      { owner_user_id: 1, sort_order: 1 },
      { name: "owner_component_order" },
    ),
    meta.createIndex(
      { owner_user_id: 1 },
      { name: "owner_meta_unique", unique: true },
    ),
  ]);
  await globalThis.carnivalDevelopmentIndexesPromise;
  return {
    components,
    features,
    meta,
    runTransaction: async <T>(operation: (session: ClientSession) => Promise<T>) => {
      const session = client.startSession();
      let result: T | undefined;
      try {
        await session.withTransaction(async () => {
          result = await operation(session);
        });
        if (result === undefined) throw new Error("Development transaction produced no result.");
        return result;
      } finally {
        await session.endSession();
      }
    },
  };
}

function publicComponent(document: DevelopmentComponentDocument): DevelopmentComponentRecord {
  return {
    createdAt: document.created_at.toISOString(),
    hidden: document.hidden,
    icon: document.icon,
    id: document.component_id,
    name: document.name,
    sortOrder: document.sort_order,
    updatedAt: document.updated_at.toISOString(),
  };
}

function publicFeature(document: DevelopmentFeatureDocument): DevelopmentFeature {
  return {
    component: document.component,
    componentId: document.component_id ?? "",
    createdAt: document.created_at.toISOString(),
    dependencies: document.dependencies,
    description: document.description,
    featureId: document.human_feature_id ?? "",
    id: document.feature_id,
    notes: document.notes,
    priority: document.priority,
    sequence: document.sequence,
    status: document.status,
    title: document.title,
    updatedAt: document.updated_at.toISOString(),
  };
}

function nameKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

export class MongoDevelopmentFeatureRepository {
  constructor(private readonly collections: () => Promise<Collections> = defaultCollections) {}

  async ensureDevelopmentData(ownerUserId: string) {
    await this.ensureComponentSeed(ownerUserId);
    await this.ensureDemoSeed(ownerUserId);
    await this.ensureFeatureReferences(ownerUserId);
  }

  async ensureFeatureReferences(ownerUserId: string) {
    const collections = await this.collections();
    const ensure = async (session?: ClientSession) => {
      const seeded = await collections.meta.findOne({
        feature_reference_seed_version: { $gte: FEATURE_REFERENCE_SEED_VERSION },
        owner_user_id: ownerUserId,
      }, session ? { session } : undefined);
      if (seeded) return;

      const documents = await collections.features.find(
        { owner_user_id: ownerUserId },
        {
          projection: { _id: 0, created_at: 1, feature_id: 1, human_feature_id: 1, sequence: 1 },
          session,
        },
      ).toArray();
      documents.sort((left, right) =>
        left.created_at.getTime() - right.created_at.getTime() ||
        (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
        left.feature_id.localeCompare(right.feature_id));
      let lastFeatureNumber = documents.reduce((maximum, document) => {
        const normalized = document.human_feature_id
          ? normalizeDevelopmentFeatureId(document.human_feature_id)
          : null;
        return normalized ? Math.max(maximum, Number(normalized.slice(3))) : maximum;
      }, 0);
      const missing = documents.filter((document) => !document.human_feature_id);
      if (missing.length > 0) {
        await collections.features.bulkWrite(missing.map((document) => ({
          updateOne: {
            filter: { feature_id: document.feature_id, owner_user_id: ownerUserId },
            update: { $set: { human_feature_id: formatDevelopmentFeatureId(++lastFeatureNumber) } },
          },
        })), { ordered: true, session });
      }
      const now = new Date();
      await collections.meta.updateOne(
        { owner_user_id: ownerUserId },
        { $set: {
          feature_reference_seed_version: FEATURE_REFERENCE_SEED_VERSION,
          feature_references_seeded_at: now,
          last_feature_number: lastFeatureNumber,
          owner_user_id: ownerUserId,
        } },
        { session, upsert: true },
      );
    };
    if (collections.runTransaction) {
      await collections.runTransaction(async (session) => {
        await ensure(session);
        return true;
      });
    } else {
      await ensure();
    }
  }

  async ensureComponentSeed(ownerUserId: string) {
    const { components, features, meta } = await this.collections();
    const seeded = await meta.findOne({
      component_seed_version: { $gte: DEVELOPMENT_COMPONENT_SEED_VERSION },
      owner_user_id: ownerUserId,
    });
    if (!seeded) {
      const now = new Date();
      await components.bulkWrite(DEFAULT_DEVELOPMENT_COMPONENTS.map((component) => ({
        updateOne: {
          filter: { component_id: component.id, owner_user_id: ownerUserId },
          update: { $setOnInsert: {
            component_id: component.id,
            created_at: now,
            hidden: false,
            icon: component.icon,
            name: component.name,
            name_key: nameKey(component.name),
            owner_user_id: ownerUserId,
            sort_order: component.sortOrder,
            updated_at: now,
          } },
          upsert: true,
        },
      })));
      await Promise.all(DEFAULT_DEVELOPMENT_COMPONENTS.map((component) => features.updateMany(
        {
          component: component.name,
          owner_user_id: ownerUserId,
          $or: [{ component_id: { $exists: false } }, { component_id: "" }],
        },
        { $set: { component_id: component.id } },
      )));
      await meta.updateOne(
        { owner_user_id: ownerUserId },
        { $set: {
          component_seed_version: DEVELOPMENT_COMPONENT_SEED_VERSION,
          components_seeded_at: now,
          owner_user_id: ownerUserId,
        } },
        { upsert: true },
      );
    }
  }

  async ensureDemoSeed(ownerUserId: string) {
    const { components, features, meta } = await this.collections();
    const seeded = await meta.findOne({
      demo_seed_version: { $gte: DEVELOPMENT_DEMO_SEED_VERSION },
      owner_user_id: ownerUserId,
    });
    if (seeded) return;
    const componentNames = new Map((await components.find(
      { owner_user_id: ownerUserId },
      { projection: { component_id: 1, name: 1 } },
    ).toArray()).map((component) => [component.component_id, component.name]));
    const now = new Date();
    await features.bulkWrite(DEVELOPMENT_DEMO_FEATURES.map((feature) => ({
      updateOne: {
        filter: { feature_id: feature.id, owner_user_id: ownerUserId },
        update: { $setOnInsert: {
          component: componentNames.get(feature.componentId) ?? "PlayHouse",
          component_id: feature.componentId,
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

  async listComponents(ownerUserId: string) {
    return (await (await this.collections()).components.find(
      { owner_user_id: ownerUserId },
      { projection: { _id: 0, name_key: 0, owner_user_id: 0 } },
    ).sort({ sort_order: 1, created_at: 1 }).toArray()).map(publicComponent);
  }

  async getComponent(ownerUserId: string, componentId: string) {
    const document = await (await this.collections()).components.findOne({
      component_id: componentId,
      owner_user_id: ownerUserId,
    });
    return document ? publicComponent(document) : null;
  }

  async createComponent(ownerUserId: string, input: DevelopmentComponentInput) {
    const { components } = await this.collections();
    const final = await components.findOne(
      { owner_user_id: ownerUserId },
      { sort: { sort_order: -1 } },
    );
    const now = new Date();
    const document: DevelopmentComponentDocument = {
      component_id: randomUUID(),
      created_at: now,
      hidden: input.hidden,
      icon: input.icon,
      name: input.name,
      name_key: nameKey(input.name),
      owner_user_id: ownerUserId,
      sort_order: (final?.sort_order ?? -1) + 1,
      updated_at: now,
    };
    await components.insertOne(document);
    return publicComponent(document);
  }

  async updateComponent(ownerUserId: string, componentId: string, input: DevelopmentComponentInput) {
    const { components, features } = await this.collections();
    const document = await components.findOneAndUpdate(
      { component_id: componentId, owner_user_id: ownerUserId },
      { $set: {
        hidden: input.hidden,
        icon: input.icon,
        name: input.name,
        name_key: nameKey(input.name),
        updated_at: new Date(),
      } },
      { returnDocument: "after" },
    );
    if (!document) return null;
    await features.updateMany(
      { component_id: componentId, owner_user_id: ownerUserId },
      { $set: { component: document.name, updated_at: new Date() } },
    );
    return publicComponent(document);
  }

  async reorderComponents(ownerUserId: string, componentIds: string[]) {
    const { components } = await this.collections();
    const existingIds = (await components.find(
      { owner_user_id: ownerUserId },
      { projection: { _id: 0, component_id: 1 } },
    ).toArray()).map((component) => component.component_id);
    if (existingIds.length !== componentIds.length || existingIds.some((id) => !componentIds.includes(id))) {
      return false;
    }
    const now = new Date();
    await components.bulkWrite(componentIds.map((componentId, sortOrder) => ({
      updateOne: {
        filter: { component_id: componentId, owner_user_id: ownerUserId },
        update: { $set: { sort_order: sortOrder, updated_at: now } },
      },
    })));
    return true;
  }

  async componentFeatureCount(ownerUserId: string, componentId: string) {
    return (await this.collections()).features.countDocuments({
      component_id: componentId,
      owner_user_id: ownerUserId,
    });
  }

  async deleteComponent(ownerUserId: string, componentId: string, moveToComponentId?: string) {
    const { components, features } = await this.collections();
    const component = await components.findOne({ component_id: componentId, owner_user_id: ownerUserId });
    if (!component) return { deleted: false as const, reason: "not_found" as const };
    let featureCount = await features.countDocuments({ component_id: componentId, owner_user_id: ownerUserId });
    if (featureCount > 0) {
      if (!moveToComponentId || moveToComponentId === componentId) {
        return { deleted: false as const, featureCount, reason: "component_in_use" as const };
      }
      const destination = await components.findOne({
        component_id: moveToComponentId,
        owner_user_id: ownerUserId,
      });
      if (!destination) return { deleted: false as const, reason: "destination_not_found" as const };
      await features.updateMany(
        { component_id: componentId, owner_user_id: ownerUserId },
        { $set: {
          component: destination.name,
          component_id: destination.component_id,
          updated_at: new Date(),
        } },
      );
      featureCount = await features.countDocuments({ component_id: componentId, owner_user_id: ownerUserId });
      if (featureCount > 0) {
        return { deleted: false as const, featureCount, reason: "component_in_use" as const };
      }
    }
    const deleted = await components.deleteOne({ component_id: componentId, owner_user_id: ownerUserId });
    return deleted.deletedCount === 1
      ? { deleted: true as const }
      : { deleted: false as const, reason: "not_found" as const };
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
    await this.ensureFeatureReferences(ownerUserId);
    const collections = await this.collections();
    const { components, features, meta } = collections;
    const component = await components.findOne({
      component_id: input.componentId,
      owner_user_id: ownerUserId,
    });
    if (!component) return null;
    const create = async (session?: ClientSession) => {
      const counter = await meta.findOneAndUpdate(
        { owner_user_id: ownerUserId },
        { $inc: { last_feature_number: 1 } },
        { returnDocument: "after", session },
      );
      const allocatedFeatureNumber = counter?.last_feature_number;
      if (!Number.isSafeInteger(allocatedFeatureNumber)) {
        throw new Error("Development feature reference counter is unavailable.");
      }
      const now = new Date();
      const document: DevelopmentFeatureDocument = {
        component: component.name,
        component_id: component.component_id,
        created_at: now,
        dependencies: input.dependencies,
        description: input.description,
        feature_id: randomUUID(),
        human_feature_id: formatDevelopmentFeatureId(allocatedFeatureNumber as number),
        is_demo: false,
        notes: input.notes,
        owner_user_id: ownerUserId,
        priority: input.priority,
        sequence: input.sequence,
        status: input.status,
        title: input.title,
        updated_at: now,
      };
      if (session) await features.insertOne(document, { session });
      else await features.insertOne(document);
      return publicFeature(document);
    };
    return collections.runTransaction
      ? collections.runTransaction((session) => create(session))
      : create();
  }

  async getByHumanFeatureId(ownerUserId: string, featureId: string) {
    const normalized = normalizeDevelopmentFeatureId(featureId);
    if (!normalized) return null;
    const document = await (await this.collections()).features.findOne(
      { human_feature_id: normalized, owner_user_id: ownerUserId },
      { projection: { _id: 0, owner_user_id: 0 } },
    );
    return document ? publicFeature(document) : null;
  }

  async machineRoadmapOwner() {
    const owners = await (await this.collections()).meta.distinct("owner_user_id", {
      $or: [
        { component_seed_version: { $gte: DEVELOPMENT_COMPONENT_SEED_VERSION } },
        { feature_reference_seed_version: { $gte: FEATURE_REFERENCE_SEED_VERSION } },
      ],
    });
    return owners.length === 1 && typeof owners[0] === "string" ? owners[0] : null;
  }

  async update(ownerUserId: string, featureId: string, input: DevelopmentFeatureInput) {
    const { components, features } = await this.collections();
    const component = await components.findOne({
      component_id: input.componentId,
      owner_user_id: ownerUserId,
    });
    if (!component) return null;
    const document = await features.findOneAndUpdate(
      { feature_id: featureId, owner_user_id: ownerUserId },
      { $set: {
        component: component.name,
        component_id: component.component_id,
        dependencies: input.dependencies,
        description: input.description,
        notes: input.notes,
        priority: input.priority,
        sequence: input.sequence,
        status: input.status,
        title: input.title,
        updated_at: new Date(),
      } },
      { returnDocument: "after" },
    );
    return document ? publicFeature(document) : null;
  }

  async reorderFeatures(ownerUserId: string, featureIds: string[]) {
    const collections = await this.collections();
    const reorder = async (session?: ClientSession) => {
      const existingIds = (await collections.features.find(
        { owner_user_id: ownerUserId },
        { projection: { _id: 0, feature_id: 1 }, session },
      ).toArray()).map((feature) => feature.feature_id);
      if (
        existingIds.length !== featureIds.length ||
        existingIds.some((id) => !featureIds.includes(id))
      ) return false;
      const now = new Date();
      await collections.features.bulkWrite(featureIds.map((featureId, index) => ({
        updateOne: {
          filter: { feature_id: featureId, owner_user_id: ownerUserId },
          update: { $set: { sequence: index + 1, updated_at: now } },
        },
      })), { ordered: true, session });
      return true;
    };
    return collections.runTransaction
      ? collections.runTransaction((session) => reorder(session))
      : reorder();
  }

  async moveFeatureToComponent(ownerUserId: string, featureId: string, componentId: string) {
    const { components, features } = await this.collections();
    const component = await components.findOne({
      component_id: componentId,
      owner_user_id: ownerUserId,
    });
    if (!component) return null;
    const document = await features.findOneAndUpdate(
      { feature_id: featureId, owner_user_id: ownerUserId },
      { $set: {
        component: component.name,
        component_id: component.component_id,
        updated_at: new Date(),
      } },
      { returnDocument: "after" },
    );
    return document ? publicFeature(document) : null;
  }

  async delete(ownerUserId: string, featureId: string) {
    const { features } = await this.collections();
    const result = await features.deleteOne({ feature_id: featureId, owner_user_id: ownerUserId });
    if (result.deletedCount === 0) return false;
    await features.updateMany(
      { dependencies: featureId, owner_user_id: ownerUserId },
      { $pull: { dependencies: featureId }, $set: { updated_at: new Date() } },
    );
    return true;
  }
}

export const DEVELOPMENT_FEATURE_COLLECTION = FEATURE_COLLECTION;
export const DEVELOPMENT_COMPONENT_COLLECTION = COMPONENT_COLLECTION;
export const DEVELOPMENT_CONSOLE_META_COLLECTION = META_COLLECTION;
export const DEVELOPMENT_FEATURE_REFERENCE_SEED_VERSION = FEATURE_REFERENCE_SEED_VERSION;
