import type { MongoClientOptions } from "mongodb";

export const MONGO_CLIENT_OPTIONS = {
  connectTimeoutMS: 5_000,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5_000,
  socketTimeoutMS: 10_000,
} satisfies MongoClientOptions;

export function mongoDiagnostic(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "unknown";
  return {
    code,
    name: error instanceof Error ? error.name : "UnknownError",
  };
}
