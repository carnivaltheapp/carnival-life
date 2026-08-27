import "server-only";

import { MongoClient } from "mongodb";

import type { LegacyTaskDocument } from "./mongo-play-mapping";
import { MONGO_CLIENT_OPTIONS, mongoDiagnostic } from "./mongo-options";

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

  const startedAt = Date.now();
  console.info("[PlayHouse Mongo] connection start");
  const connection = new MongoClient(uri, MONGO_CLIENT_OPTIONS)
    .connect()
    .then((client) => {
      console.info("[PlayHouse Mongo] connection success", {
        durationMs: Date.now() - startedAt,
      });
      return client;
    })
    .catch((error: unknown) => {
      globalThis.carnivalMongoClientPromise = undefined;
      console.error("[PlayHouse Mongo] connection failure", {
        durationMs: Date.now() - startedAt,
        ...mongoDiagnostic(error),
      });
      throw error;
    });
  globalThis.carnivalMongoClientPromise = connection;
  return connection;
}

export async function getLegacyTaskCollection() {
  const client = await mongoClientPromise();
  return client.db(DATABASE_NAME).collection<LegacyTaskDocument>(COLLECTION_NAME);
}
