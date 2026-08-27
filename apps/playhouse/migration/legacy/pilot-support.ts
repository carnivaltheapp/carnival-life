import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MongoClient, ObjectId } from "mongodb";

import type { Database } from "../../lib/supabase/database.types";
import {
  APPROVED_CUTOFF,
  assignRelativeSortOrder,
  mapLegacyRecord,
  type LegacyRecord,
  type MappedRecord,
} from "./mapping";
import { PILOT_BATCH_ID, PILOT_LEGACY_IDS } from "./pilot-manifest";
import { validatePilotRecords } from "./pilot";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PilotArguments = {
  batchId: string | null;
  confirmHost: string | null;
  targetUserId: string | null;
  write: boolean;
};

export function parsePilotArguments(args: string[]): PilotArguments {
  const parsed: PilotArguments = {
    batchId: null,
    confirmHost: null,
    targetUserId: null,
    write: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--write") {
      parsed.write = true;
    } else if (argument === "--confirm-batch") {
      parsed.batchId = args[++index] ?? null;
    } else if (argument === "--confirm-supabase-host") {
      parsed.confirmHost = args[++index] ?? null;
    } else if (argument === "--target-user-id") {
      parsed.targetUserId = args[++index] ?? null;
    } else {
      throw new Error(`Unsupported pilot option: ${argument}`);
    }
  }
  return parsed;
}

export function requireWriteConfirmation(args: PilotArguments) {
  if (!args.write) {
    throw new Error("Production import requires the explicit --write flag.");
  }
  if (args.batchId !== PILOT_BATCH_ID) {
    throw new Error(`Confirm the locked batch with --confirm-batch ${PILOT_BATCH_ID}.`);
  }
  if (!args.targetUserId || !UUID_PATTERN.test(args.targetUserId)) {
    throw new Error("Provide the explicit production Carnival UUID with --target-user-id.");
  }
}

export async function loadPilotRecords() {
  const uri = process.env.LEGACY_MONGO_URI;
  if (!uri) {
    throw new Error("LEGACY_MONGO_URI is required in the gitignored .env.local file.");
  }
  const client = new MongoClient(uri, {
    readPreference: "secondaryPreferred",
    serverSelectionTimeoutMS: 15_000,
  });
  try {
    await client.connect();
    const objectIds = PILOT_LEGACY_IDS.map((id) => new ObjectId(id));
    const source = await client
      .db("restlandmark")
      .collection<LegacyRecord>("tasks_task")
      .find({
        _id: { $in: objectIds },
        is_active: true,
        is_deleted: false,
        task_date: { $gte: APPROVED_CUTOFF },
      })
      .toArray();
    const byId = new Map(source.map((record) => [String(record._id), mapLegacyRecord(record)]));
    const records = PILOT_LEGACY_IDS.flatMap((id) => {
      const record = byId.get(id);
      return record ? [record] : [];
    });
    assignRelativeSortOrder(records);
    const issues = validatePilotRecords(records);
    if (issues.length > 0) {
      throw new Error(`Pilot source validation failed:\n${issues.join("\n")}`);
    }
    return records;
  } finally {
    await client.close();
  }
}

export function pilotPlan(records: MappedRecord[]) {
  return records.map((record) => ({
    branch: record.mapped.branch,
    destination:
      record.mapped.placement?.kind === "basket"
        ? { basket: record.mapped.placement.basketName, kind: "basket" }
        : {
            date:
              record.mapped.placement?.kind === "calendar"
                ? record.mapped.placement.scheduledDate
                : null,
            kind: "calendar",
          },
    durationMinutes: record.mapped.durationMinutes,
    externalIds: record.mapped.externalIds,
    legacyMongoId: record.legacy.id,
    note: record.mapped.note,
    place: record.mapped.place,
    playType: record.mapped.playType,
    player: record.mapped.player
      ? {
          cachedDisplayName: record.mapped.player.cachedDisplayName,
          legacyContactId: record.mapped.player.legacyContactId,
          resolution: "pending_exact_contact_reference_match",
        }
      : { resolution: "no_legacy_player" },
    pushRule: record.mapped.pushRule,
    sourceType: record.mapped.sourceType,
    title: record.mapped.title,
    url: record.mapped.url,
  }));
}

export async function writePrivatePilotReport(
  name: "import-result" | "plan" | "rollback-result",
  value: unknown,
) {
  const directory = resolve("migration-reports");
  const path = resolve(directory, `legacy-pilot-${name}-${PILOT_BATCH_ID}.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

export function productionClient(args: PilotArguments) {
  requireWriteConfirmation(args);
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Production writes require SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  const host = new URL(url).host;
  if (!args.confirmHost || args.confirmHost !== host) {
    throw new Error(`Confirm the exact destination with --confirm-supabase-host ${host}.`);
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function verifyTargetUser(
  supabase: SupabaseClient<Database>,
  targetUserId: string,
) {
  const [profileResult, authResult] = await Promise.all([
    supabase.from("users").select("id, display_name").eq("id", targetUserId).maybeSingle(),
    supabase.auth.admin.getUserById(targetUserId),
  ]);
  if (profileResult.error || !profileResult.data || authResult.error || !authResult.data.user) {
    throw new Error("The explicit target UUID is not a valid production Carnival user/profile.");
  }
  return {
    displayName: profileResult.data.display_name,
    email: authResult.data.user.email ?? null,
    id: targetUserId,
  };
}
