import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  LEGACY_SOURCE_FIELDS,
  mapLegacyRecord,
  serializeLegacySourceRecord,
  type LegacyRecord,
} from "./mapping";
import {
  classifyExistingPilotPlays,
  isPilotBatchMetadata,
  pilotPlayInsert,
  pilotSourceMetadata,
  validatePilotRecords,
  validateRollbackRows,
  type ExistingPilotPlay,
} from "./pilot";
import {
  PILOT_BATCH_ID,
  PILOT_KIND,
  PILOT_LEGACY_DAYS,
  PILOT_LEGACY_IDS,
} from "./pilot-manifest";
import { parsePilotArguments, requireWriteConfirmation } from "./pilot-support";

function legacyRecord(id: string, overrides: Partial<LegacyRecord> = {}) {
  return {
    _id: id,
    action_type: `Pilot ${id}`,
    branch: "Pilot",
    created_date: new Date("2026-08-20T18:00:00Z"),
    duration: 30,
    event_id: "calendar-event",
    is_active: true,
    is_deleted: false,
    place: "office",
    priority_index: "10-00000128",
    push_type: "Everyday",
    regarding: "user",
    task_date: new Date("2026-08-26T00:00:00Z"),
    task_type: "H",
    updated_date: new Date("2026-08-25T18:00:00Z"),
    ...overrides,
  } satisfies LegacyRecord;
}

function cleanPilotRecords() {
  return PILOT_LEGACY_IDS.map((id, index) =>
    mapLegacyRecord(
      legacyRecord(id, {
        push_type: index % 3 === 0 ? "Everyday" : index % 3 === 1 ? "Weekday" : "Weekend",
        task_date: new Date(`${PILOT_LEGACY_DAYS[index]}T00:00:00Z`),
        task_type: index === 0 ? "S" : "H",
      }),
    ),
  );
}

function existingPlay(
  legacyMongoId: string,
  sourceMetadata = pilotSourceMetadata(mapLegacyRecord(legacyRecord(legacyMongoId))),
): ExistingPilotPlay {
  return {
    id: `play-${legacyMongoId}`,
    legacy_mongo_id: legacyMongoId,
    source_metadata: sourceMetadata,
  };
}

describe("legacy pilot selection", () => {
  it("locks exactly 16 unique H/S legacy IDs", () => {
    expect(PILOT_LEGACY_IDS).toHaveLength(16);
    expect(new Set(PILOT_LEGACY_IDS)).toHaveProperty("size", 16);
    expect(validatePilotRecords(cleanPilotRecords())).toEqual([]);
  });

  it("rejects undocumented or malformed mappings", () => {
    const records = cleanPilotRecords();
    records[0] = mapLegacyRecord(legacyRecord(PILOT_LEGACY_IDS[0], { task_type: "A" }));
    records[1] = mapLegacyRecord(
      legacyRecord(PILOT_LEGACY_IDS[1], { task_date: new Date("2200-01-06T00:00:00Z") }),
    );
    records[2] = mapLegacyRecord(legacyRecord(PILOT_LEGACY_IDS[2], { duration: null }));
    expect(validatePilotRecords(records)).toEqual(
      expect.arrayContaining([expect.stringContaining("not a clean documented mapping")]),
    );
  });

  it("rejects any selection other than the locked 16", () => {
    expect(validatePilotRecords(cleanPilotRecords().slice(0, 15))).toEqual(
      expect.arrayContaining([expect.stringContaining("exactly 16")]),
    );
  });
});

describe("pilot identity and idempotency", () => {
  it("preserves legacy ID and batch identity in the Play insert", () => {
    const record = cleanPilotRecords()[0];
    const insert = pilotPlayInsert(record, "00000000-0000-4000-8000-000000000001", null, null);
    expect(insert.legacy_mongo_id).toBe(PILOT_LEGACY_IDS[0]);
    expect(isPilotBatchMetadata(insert.source_metadata)).toBe(true);
    expect(insert.source_metadata).toMatchObject({
      migration: { batch_id: PILOT_BATCH_ID, kind: PILOT_KIND },
    });
  });

  it("preserves unresolved Player metadata without inventing a contact relationship", () => {
    const record = mapLegacyRecord(
      legacyRecord(PILOT_LEGACY_IDS[0], {
        contact_id: "opaque-legacy-contact",
        email: "player@example.test",
        first: "Example",
        last: "Player",
        task_type: "S",
      }),
    );
    const insert = pilotPlayInsert(record, "00000000-0000-4000-8000-000000000001", null, null);
    expect(insert.player_contact_id).toBeNull();
    expect(insert.source_metadata).toMatchObject({
      migration: {
        legacy_contact: {
          cached_display_name: "Example Player",
          email: "player@example.test",
          legacy_contact_id: "opaque-legacy-contact",
        },
      },
    });
  });

  it("preserves every original Mongo field with BSON values in Extended JSON", () => {
    const source = legacyRecord(PILOT_LEGACY_IDS[0], {
      amount: 0,
      is_pushed: false,
      note: "",
      old_task_id: null,
    });
    const serialized = serializeLegacySourceRecord(source) as Record<string, unknown>;
    expect(Object.keys(serialized)).toEqual(expect.arrayContaining([...LEGACY_SOURCE_FIELDS]));
    expect(serialized).toMatchObject({
      amount: { $numberInt: "0" },
      is_pushed: false,
      note: "",
      old_task_id: null,
    });
    expect(serialized._id).toBe(PILOT_LEGACY_IDS[0]);
    expect(serialized.created_date).toEqual({ $date: { $numberLong: "1787248800000" } });
    expect(pilotSourceMetadata(mapLegacyRecord(source))).toMatchObject({
      legacy_source: serialized,
    });
  });

  it("classifies same-batch rows as idempotent and foreign rows as conflicts", () => {
    const sameBatch = existingPlay(PILOT_LEGACY_IDS[0]);
    const conflict = existingPlay(PILOT_LEGACY_IDS[1], {
      migration: { batch_id: "00000000-0000-4000-8000-000000000002", kind: PILOT_KIND },
    });
    const result = classifyExistingPilotPlays([sameBatch, conflict]);
    expect(result.existing).toEqual([sameBatch]);
    expect(result.conflicts).toEqual([conflict]);
    expect(result.missingLegacyIds).toHaveLength(14);
  });

  it("requires explicit write, batch, and target confirmation", () => {
    expect(() => requireWriteConfirmation(parsePilotArguments([]))).toThrow("--write");
    expect(() =>
      requireWriteConfirmation(
        parsePilotArguments([
          "--write",
          "--confirm-batch",
          PILOT_BATCH_ID,
          "--target-user-id",
          "00000000-0000-4000-8000-000000000001",
        ]),
      ),
    ).not.toThrow();
  });
});

describe("pilot rollback safety", () => {
  it("accepts only locked rows carrying the exact batch marker", () => {
    expect(validateRollbackRows([existingPlay(PILOT_LEGACY_IDS[0])], PILOT_BATCH_ID)).toEqual([]);
    expect(
      validateRollbackRows([existingPlay("ffffffffffffffffffffffff")], PILOT_BATCH_ID),
    ).toEqual([expect.stringContaining("outside the locked pilot manifest")]);
  });
});

describe("Mongo read-only and dry-run guards", () => {
  it("contains no Mongo mutation call in pilot or dry-run entrypoints", () => {
    const mutationPattern =
      /\.(?:bulkWrite|deleteMany|deleteOne|insertMany|insertOne|replaceOne|updateMany|updateOne)\s*\(/;
    for (const file of ["./cli.ts", "./pilot-cli.ts", "./pilot-support.ts"]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toMatch(mutationPattern);
    }
    expect(readFileSync(new URL("./cli.ts", import.meta.url), "utf8")).not.toMatch(/supabase/i);
  });
});
