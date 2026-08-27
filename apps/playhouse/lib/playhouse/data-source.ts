export const PLAYHOUSE_DATA_SOURCES = ["mongo", "supabase"] as const;

export type PlayhouseDataSource = (typeof PLAYHOUSE_DATA_SOURCES)[number];

export function resolvePlayhouseDataSource(
  configuredValue = process.env.PLAYHOUSE_DATA_SOURCE,
): PlayhouseDataSource {
  const value = configuredValue?.trim().toLowerCase();

  if (!value || value === "mongo") {
    return "mongo";
  }
  if (value === "supabase") {
    return "supabase";
  }

  throw new Error("PLAYHOUSE_DATA_SOURCE must be either mongo or supabase.");
}
