import "server-only";

import { MongoClient } from "mongodb";

import type { LegacyTaskDocument } from "./mongo-play-mapping";

const DATABASE_NAME = "restlandmark";
const COLLECTION_NAME = "tasks_task";

declare global {
  var carnivalMongoClientPromise: Promise<MongoClient> | undefined;
}

function mongoClientPromise() {
  if (globalThis.carnivalMongoClientPromise) {
    return globalThis.carnivalMongoClientPromise;
  }

  const uri = process.env.LEGACY_MONGO_URI?.trim();
  if (!uri) {
    throw new Error("LEGACY_MONGO_URI is required when PlayHouse uses Mongo.");
  }

  const connection = new MongoClient(uri, { maxPoolSize: 10 }).connect();
  globalThis.carnivalMongoClientPromise = connection;
  return connection;
}

export async function getLegacyTaskCollection() {
  const client = await mongoClientPromise();
  return client.db(DATABASE_NAME).collection<LegacyTaskDocument>(COLLECTION_NAME);
}
