import type { Json } from "../../lib/supabase/database.types";
import { classifyExistingPilotPlays, pilotPlayInsert } from "./pilot";
import { PILOT_BATCH_ID, PILOT_KIND, PILOT_LEGACY_IDS } from "./pilot-manifest";
import {
  loadPilotRecords,
  parsePilotArguments,
  pilotPlan,
  productionClient,
  verifyTargetUser,
  writePrivatePilotReport,
} from "./pilot-support";

async function main() {
  const args = parsePilotArguments(process.argv.slice(2));
  const records = await loadPilotRecords();
  const plan = pilotPlan(records);
  const planPath = await writePrivatePilotReport("plan", {
    actuallyImported: 0,
    batchId: PILOT_BATCH_ID,
    dryRun: !args.write,
    records: plan,
  });
  process.stdout.write(`${JSON.stringify({ batchId: PILOT_BATCH_ID, records: plan }, null, 2)}\n`);
  process.stdout.write(`Private pilot plan: ${planPath}\n`);

  if (!args.write) {
    process.stdout.write("Actually imported: 0 (plan-only; --write was not supplied)\n");
    return;
  }

  const supabase = productionClient(args);
  const targetUserId = args.targetUserId as string;
  const target = await verifyTargetUser(supabase, targetUserId);
  const [{ data: basketRows, error: basketError }, { data: existingRows, error: existingError }] =
    await Promise.all([
      supabase.from("baskets").select("id, slug").eq("owner_user_id", targetUserId),
      supabase
        .from("plays")
        .select("id, legacy_mongo_id, source_metadata")
        .eq("owner_user_id", targetUserId)
        .in("legacy_mongo_id", [...PILOT_LEGACY_IDS]),
    ]);
  if (basketError || existingError) {
    throw new Error("Production preflight could not read the target user's Baskets/Plays.");
  }
  const classification = classifyExistingPilotPlays(existingRows ?? []);
  if (classification.conflicts.length > 0) {
    throw new Error("At least one pilot legacy ID already exists outside this pilot batch.");
  }
  const baskets = new Map((basketRows ?? []).map((basket) => [basket.slug, basket.id]));
  const missing = new Set(classification.missingLegacyIds);
  const legacyContactIds = records.flatMap((record) =>
    record.mapped.player ? [record.mapped.player.legacyContactId] : [],
  );
  const { data: contacts, error: contactError } =
    legacyContactIds.length > 0
      ? await supabase
          .from("contact_references")
          .select("id, provider_resource_name")
          .eq("owner_user_id", targetUserId)
          .in("provider_resource_name", legacyContactIds)
      : { data: [], error: null };
  if (contactError) {
    throw new Error("Production preflight could not safely resolve Player references.");
  }
  const contactsByProviderId = new Map(
    (contacts ?? []).flatMap((contact) =>
      contact.provider_resource_name
        ? [[contact.provider_resource_name, contact.id] as const]
        : [],
    ),
  );

  const inserts = records
    .filter((record) => missing.has(record.legacy.id))
    .map((record) => {
      const placement = record.mapped.placement;
      const basketId =
        placement?.kind === "basket" ? (baskets.get(placement.basketSlug) ?? null) : null;
      if (placement?.kind === "basket" && !basketId) {
        throw new Error(`Target user is missing documented Basket ${placement.basketSlug}.`);
      }
      const playerContactId = record.mapped.player
        ? (contactsByProviderId.get(record.mapped.player.legacyContactId) ?? null)
        : null;
      return pilotPlayInsert(record, targetUserId, basketId, playerContactId);
    });
  const { data: createdRows, error: createError } =
    inserts.length > 0
      ? await supabase.from("plays").insert(inserts).select("id, legacy_mongo_id")
      : { data: [], error: null };
  if (createError || (createdRows?.length ?? 0) !== inserts.length) {
    throw new Error("The atomic pilot Play insert failed; no new pilot Plays were accepted.");
  }

  const { data: allRows, error: verifyError } = await supabase
    .from("plays")
    .select("id, legacy_mongo_id, player_contact_id, source_metadata")
    .eq("owner_user_id", targetUserId)
    .in("legacy_mongo_id", [...PILOT_LEGACY_IDS]);
  if (verifyError || (allRows?.length ?? 0) !== 10) {
    throw new Error("Post-insert verification did not find exactly 10 pilot Plays.");
  }

  const { data: eventRows, error: eventReadError } = await supabase
    .from("play_events")
    .select("play_id")
    .eq("owner_user_id", targetUserId)
    .eq("correlation_id", PILOT_BATCH_ID)
    .eq("event_type", "migration_import");
  if (eventReadError) {
    throw new Error("Pilot event-history preflight failed.");
  }
  const eventPlayIds = new Set((eventRows ?? []).map((event) => event.play_id));
  const missingEvents = (allRows ?? []).filter((play) => !eventPlayIds.has(play.id));
  if (missingEvents.length > 0) {
    const { error: eventError } = await supabase.from("play_events").insert(
      missingEvents.map((play) => ({
        actor_user_id: targetUserId,
        correlation_id: PILOT_BATCH_ID,
        event_type: "migration_import",
        owner_user_id: targetUserId,
        payload: {
          after: { legacy_mongo_id: play.legacy_mongo_id },
          batch_id: PILOT_BATCH_ID,
          migration_kind: PILOT_KIND,
        } satisfies Json,
        play_id: play.id,
        source: "migration" as const,
      })),
    );
    if (eventError) {
      const createdIds = (createdRows ?? []).map((play) => play.id);
      if (createdIds.length > 0) {
        const { error: cleanupError } = await supabase
          .from("plays")
          .delete()
          .eq("owner_user_id", targetUserId)
          .in("id", createdIds);
        if (cleanupError) {
          throw new Error(
            "Pilot event creation and automatic cleanup both failed; stop and inspect the batch immediately.",
          );
        }
      }
      throw new Error("Pilot event creation failed; Plays created by this run were rolled back.");
    }
  }

  const byLegacyId = new Map((allRows ?? []).map((play) => [play.legacy_mongo_id, play]));
  const result = {
    actuallyImported: 10,
    batchId: PILOT_BATCH_ID,
    records: records.map((record) => {
      const play = byLegacyId.get(record.legacy.id);
      return {
        ...pilotPlan([record])[0],
        importStatus: missing.has(record.legacy.id) ? "created" : "already_present",
        playerResolution: play?.player_contact_id ? "resolved_exactly" : "unresolved_preserved",
        supabaseId: play?.id ?? null,
      };
    }),
    target,
  };
  const resultPath = await writePrivatePilotReport("import-result", result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Private pilot result: ${resultPath}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown pilot import error.";
  process.stderr.write(`Legacy pilot import stopped: ${message}\n`);
  process.exitCode = 1;
});
