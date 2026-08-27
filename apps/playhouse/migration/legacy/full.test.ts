import { describe, expect, it } from "vitest";

import {
  FULL_BATCH_ID,
  FULL_MIGRATION_KIND,
  UP_BATCH_ID,
  UP_MIGRATION_KIND,
  contactSeed,
  fullPlayInsert,
  parseFullArguments,
  partitionFullRecords,
  requireFullWriteConfirmation,
  validateFullSource,
} from "./full";
import { LEGACY_SOURCE_FIELDS, mapLegacyRecord, type LegacyRecord } from "./mapping";

function source(overrides: Partial<LegacyRecord> = {}) {
  return {
    _id: "full-import-id",
    action_type: "Full import Play",
    contact_id: "c-authoritative-google-id",
    duration: 30,
    first: "Player",
    is_active: true,
    is_deleted: false,
    push_type: "Everyday",
    regarding: "user",
    task_date: new Date("2026-08-27T00:00:00Z"),
    task_type: "H",
    ...overrides,
  } satisfies LegacyRecord;
}

describe("legacy full import guards", () => {
  it("requires explicit write, user, and exact host", () => {
    expect(() => requireFullWriteConfirmation(parseFullArguments([]), "example.supabase.co")).toThrow(
      "--write",
    );
    expect(() =>
      requireFullWriteConfirmation(
        parseFullArguments([
          "--write",
          "--target-user-id",
          "00000000-0000-4000-8000-000000000001",
          "--confirm-supabase-host",
          "example.supabase.co",
        ]),
        "example.supabase.co",
      ),
    ).not.toThrow();
  });

  it("skips undocumented Baskets and rejects task types outside the selected run", () => {
    const unsupported = mapLegacyRecord(source({ task_date: new Date("2200-01-06T00:00:00Z") }));
    expect(validateFullSource([unsupported]).unsupportedBaskets).toHaveLength(1);
    expect(partitionFullRecords([unsupported])).toEqual({ importable: [], skipped: [unsupported] });
    expect(() => validateFullSource([mapLegacyRecord(source({ task_type: "U" }))])).toThrow(
      "disallowed task_type",
    );
  });

  it("maps U and P to Normal while preserving the Headline semantic and original type", () => {
    for (const taskType of ["U", "P"] as const) {
      const record = mapLegacyRecord(source({ task_type: taskType }));
      expect(record.mapped.playType).toBe("normal");
      expect(validateFullSource([record], ["U", "P"]).preservationFailures).toEqual([]);
      const insert = fullPlayInsert(
        record,
        "00000000-0000-4000-8000-000000000001",
        null,
        "00000000-0000-4000-8000-000000000003",
        UP_BATCH_ID,
        UP_MIGRATION_KIND,
      );
      expect(insert.source_metadata).toMatchObject({
        legacy_source: { task_type: taskType },
        migration: {
          batch_id: UP_BATCH_ID,
          kind: UP_MIGRATION_KIND,
          legacy_headline: true,
        },
      });
    }
  });

  it("preserves complete source metadata and resolves authoritative Player IDs", () => {
    const record = mapLegacyRecord(source({ amount: 0, is_pushed: false, note: "" }));
    expect(validateFullSource([record]).preservationFailures).toEqual([]);
    const seed = contactSeed(
      record,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    );
    expect(seed?.provider_resource_name).toBe("c-authoritative-google-id");
    const insert = fullPlayInsert(
      record,
      "00000000-0000-4000-8000-000000000001",
      null,
      "00000000-0000-4000-8000-000000000003",
    );
    expect(insert.player_contact_id).toBe("00000000-0000-4000-8000-000000000003");
    expect(insert.source_metadata).toMatchObject({
      migration: { batch_id: FULL_BATCH_ID, kind: FULL_MIGRATION_KIND },
    });
    const raw = (insert.source_metadata as Record<string, unknown>).legacy_source as Record<
      string,
      unknown
    >;
    expect(Object.keys(raw)).toEqual(expect.arrayContaining([...LEGACY_SOURCE_FIELDS]));
    expect(raw).toMatchObject({ is_pushed: false, note: "" });
  });
});
