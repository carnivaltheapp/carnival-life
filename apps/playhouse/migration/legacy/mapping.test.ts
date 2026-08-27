import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  assignRelativeSortOrder,
  findDuplicateLegacyIds,
  isApprovedCandidate,
  mapLegacyRecord,
  type LegacyRecord,
} from "./mapping";
import { buildSummary } from "./report";

function realRecord(overrides: Partial<LegacyRecord> = {}): LegacyRecord {
  return {
    _id: "legacy-1",
    action_type: "Representative Play",
    branch: "Carnival",
    contact_id: "opaque-google-contact-id",
    created_date: new Date("2026-08-20T18:00:00Z"),
    duration: 30,
    email: "player@example.test",
    event_id: "calendar-event-id",
    first: "Example",
    is_active: true,
    is_deleted: false,
    last: "Player",
    last_id: "last-gmail-id",
    long_id: "long-calendar-id",
    message_id: "gmail-message-id",
    note: "A note",
    place: "office",
    priority_index: "10-00000128",
    push_type: "Everyday",
    regarding: "email",
    task_date: new Date("2026-08-26T00:00:00Z"),
    task_status: "T",
    task_type: "H",
    thread_id: "gmail-thread-id",
    updated_date: new Date("2026-08-25T18:00:00Z"),
    url: "example.com",
    user_id: 1,
    ...overrides,
  };
}

describe("legacy approved population", () => {
  it("requires active, non-deleted records on or after the cutoff", () => {
    expect(isApprovedCandidate(realRecord())).toBe(true);
    expect(isApprovedCandidate(realRecord({ is_active: false }))).toBe(false);
    expect(isApprovedCandidate(realRecord({ is_deleted: true }))).toBe(false);
    expect(
      isApprovedCandidate(realRecord({ task_date: new Date("2026-08-24T23:59:59Z") })),
    ).toBe(false);
  });
});

describe("dry-run safety", () => {
  it("has no Supabase dependency or Mongo mutation call and always reports zero writes", () => {
    const cliSource = readFileSync(new URL("./cli.ts", import.meta.url), "utf8");
    expect(cliSource).not.toMatch(/supabase/i);
    expect(cliSource).not.toMatch(
      /\.(?:bulkWrite|deleteMany|deleteOne|insertMany|insertOne|replaceOne|updateMany|updateOne)\s*\(/,
    );
    expect(buildSummary([mapLegacyRecord(realRecord())], [])).toMatchObject({
      actuallyWritten: 0,
    });
  });
});

describe("legacy Play mapping", () => {
  it("maps a representative observed calendar/email record without writing", () => {
    const result = mapLegacyRecord(realRecord());
    expect(result.mapped).toMatchObject({
      durationMinutes: 30,
      placement: { kind: "calendar", scheduledDate: "2026-08-26" },
      playType: "normal",
      pushRule: "everyday",
      sourceType: "gmail",
      status: "open",
      url: "https://example.com",
      workflow: { isWaiting: false, nextLegacyPlayId: null },
    });
    expect(result.mapped.player).toMatchObject({
      cachedDisplayName: "Example Player",
      legacyContactId: "opaque-google-contact-id",
      resolution: "legacy_contact_reference_required",
    });
    expect(result).not.toHaveProperty("supabase");
  });

  it.each([
    ["2200-01-01", "on-the-way"],
    ["2200-01-02", "to-go"],
    ["2300-01-01", "in-touch"],
    ["2400-01-01", "soon"],
    ["2400-01-11", "backlog"],
    ["2500-01-01", "later"],
    ["2600-01-01", "to-watch"],
  ])("maps supported Basket sentinel %s", (date, basketSlug) => {
    expect(
      mapLegacyRecord(realRecord({ task_date: new Date(`${date}T00:00:00Z`) })).mapped
        .placement,
    ).toMatchObject({ basketSlug, kind: "basket" });
  });

  it("reports unsupported Basket dates rather than guessing", () => {
    const result = mapLegacyRecord(
      realRecord({ task_date: new Date("2200-01-06T00:00:00Z") }),
    );
    expect(result.wouldImport).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "unsupported_basket_date" }));
  });

  it.each([
    ["H", "normal", false],
    ["S", "reminder", true],
  ])("maps documented task type %s", (taskType, playType, isWaiting) => {
    const result = mapLegacyRecord(realRecord({ task_type: taskType }));
    expect(result.mapped.playType).toBe(playType);
    expect(result.mapped.workflow.isWaiting).toBe(isWaiting);
  });

  it("rejects malformed and undocumented required values", () => {
    const result = mapLegacyRecord(
      realRecord({ action_type: "", duration: null, push_type: "none", task_type: "A" }),
    );
    expect(result.wouldImport).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["missing_title", "unsupported_task_type", "unsupported_push_rule"]),
    );
  });

  it("recovers the observed uppercase Branch anomaly with a warning", () => {
    const result = mapLegacyRecord(realRecord({ Branch: "Recovered", branch: undefined }));
    expect(result.mapped.branch).toBe("Recovered");
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "uppercase_branch_field" }));
  });

  it("detects duplicate legacy IDs and derives stable relative order", () => {
    const first = mapLegacyRecord(realRecord({ _id: "duplicate", priority_index: "20-00000002" }));
    const second = mapLegacyRecord(
      realRecord({ _id: "duplicate", priority_index: "10-00000001" }),
    );
    expect(findDuplicateLegacyIds([first, second])).toEqual(["duplicate"]);
    assignRelativeSortOrder([first, second]);
    expect(second.mapped.sortOrder).toBe(1000);
    expect(first.mapped.sortOrder).toBe(2000);
  });
});
