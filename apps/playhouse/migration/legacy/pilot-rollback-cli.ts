import { PILOT_BATCH_ID, PILOT_KIND } from "./pilot-manifest";
import { validateRollbackRows } from "./pilot";
import {
  parsePilotArguments,
  productionClient,
  verifyTargetUser,
  writePrivatePilotReport,
} from "./pilot-support";

async function main() {
  const args = parsePilotArguments(process.argv.slice(2));
  const supabase = productionClient(args);
  const targetUserId = args.targetUserId as string;
  const target = await verifyTargetUser(supabase, targetUserId);
  const { data: rows, error } = await supabase
    .from("plays")
    .select("id, legacy_mongo_id, source_metadata")
    .eq("owner_user_id", targetUserId)
    .contains("source_metadata", {
      migration: { batch_id: PILOT_BATCH_ID, kind: PILOT_KIND },
    });
  if (error) {
    throw new Error("Could not read the specified pilot batch for rollback.");
  }
  const issues = validateRollbackRows(rows ?? [], PILOT_BATCH_ID);
  if (issues.length > 0) {
    throw new Error(`Rollback scope validation failed:\n${issues.join("\n")}`);
  }
  const ids = (rows ?? []).map((row) => row.id);
  if (ids.length > 0) {
    const [fromResult, toResult] = await Promise.all([
      supabase.from("play_relationships").select("id").in("from_play_id", ids).limit(1),
      supabase.from("play_relationships").select("id").in("to_play_id", ids).limit(1),
    ]);
    if (fromResult.error || toResult.error) {
      throw new Error("Rollback relationship safety check failed; nothing was removed.");
    }
    const fromRelationships = fromResult.data;
    const toRelationships = toResult.data;
    if ((fromRelationships?.length ?? 0) > 0 || (toRelationships?.length ?? 0) > 0) {
      throw new Error("Rollback stopped because a pilot Play now participates in a relationship.");
    }
    const { error: deleteError } = await supabase
      .from("plays")
      .delete()
      .eq("owner_user_id", targetUserId)
      .in("id", ids);
    if (deleteError) {
      throw new Error("Pilot rollback failed; verify production state before retrying.");
    }
  }
  const result = {
    batchId: PILOT_BATCH_ID,
    removedPlayIds: ids,
    removedPlays: ids.length,
    target,
  };
  const resultPath = await writePrivatePilotReport("rollback-result", {
    operation: "rollback",
    ...result,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Private rollback result: ${resultPath}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown pilot rollback error.";
  process.stderr.write(`Legacy pilot rollback stopped: ${message}\n`);
  process.exitCode = 1;
});
