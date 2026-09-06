import { describe, expect, it } from "vitest";

import {
  CARNIVAL_CALENDAR_SEMANTICS,
  calendarDiscoveryRows,
  detectCarnivalCalendarSemanticRole,
  getCarnivalCalendarSemantic,
  type CarnivalCalendarSemanticRole,
} from "./calendar-settings";

const calendars = [
  {
    accessRole: "owner",
    isPrimary: true,
    providerCalendarId: "primary",
    summary: "Primary",
    timeZone: "America/Los_Angeles",
  },
  {
    accessRole: "reader",
    isPrimary: false,
    providerCalendarId: "shared",
    summary: "Shared",
    timeZone: "UTC",
  },
];

describe("Calendar discovery persistence", () => {
  it("defaults only the primary calendar to Blocking", () => {
    const rows = calendarDiscoveryRows({
      calendars,
      existingModes: new Map(),
      existingSemanticRoles: new Map(),
      googleAccountId: "account-id",
      ownerUserId: "owner-id",
    });

    expect(rows.map((row) => [row.provider_calendar_id, row.is_blocking])).toEqual([
      ["primary", true],
      ["shared", false],
    ]);
  });

  it("preserves Carnival configuration when Google metadata refreshes", () => {
    const rows = calendarDiscoveryRows({
      calendars,
      existingModes: new Map([
        ["primary", "ignored"],
        ["shared", "blocking"],
      ]),
      existingSemanticRoles: new Map(),
      googleAccountId: "account-id",
      ownerUserId: "owner-id",
    });

    expect(rows.map((row) => [row.provider_calendar_id, row.is_blocking])).toEqual([
      ["primary", false],
      ["shared", true],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/token|credential|secret/i);
  });

  it.each([
    ["AT_Appointments", "appointment"],
    ["AT_Events", "event"],
    ["AT_Places", "place"],
    ["AT_Plays", "play"],
    ["AT_Reminders", "reminder"],
    ["AT_Done", "done"],
  ] satisfies [string, CarnivalCalendarSemanticRole][])(
    "classifies %s as %s",
    (summary, role) => {
      expect(detectCarnivalCalendarSemanticRole(summary)).toBe(role);
    },
  );

  it("does not classify similarly named ordinary calendars", () => {
    expect(detectCarnivalCalendarSemanticRole("AT_ Appointments")).toBe("none");
    expect(detectCarnivalCalendarSemanticRole("Events")).toBe("none");
  });

  it("defines authoritative input, output, and blocking behavior", () => {
    expect(CARNIVAL_CALENDAR_SEMANTICS.appointment).toMatchObject({
      blockingScope: "event_time",
      direction: "google_to_carnival",
    });
    expect(CARNIVAL_CALENDAR_SEMANTICS.event).toMatchObject({
      blockingScope: "event_time",
      direction: "google_to_carnival",
    });
    expect(CARNIVAL_CALENDAR_SEMANTICS.place).toMatchObject({
      blockingScope: "whole_day",
      direction: "google_to_carnival",
    });
    for (const role of ["play", "reminder", "done"] as const) {
      expect(CARNIVAL_CALENDAR_SEMANTICS[role]).toMatchObject({
        blockingScope: "none",
        direction: "carnival_to_google",
      });
    }
    expect(getCarnivalCalendarSemantic("none")).toBeNull();
  });

  it("persists a semantic assignment by calendar ID when Google renames it", () => {
    const [row] = calendarDiscoveryRows({
      calendars: [{ ...calendars[1], summary: "Renamed in Google" }],
      existingModes: new Map([["shared", "blocking"]]),
      existingSemanticRoles: new Map([["shared", "appointment"]]),
      googleAccountId: "account-id",
      ownerUserId: "owner-id",
    });

    expect(row).toMatchObject({
      is_blocking: true,
      provider_calendar_id: "shared",
      semantic_role: "appointment",
      summary: "Renamed in Google",
    });
  });

  it("keeps ordinary calendar Blocking/Ignored configuration", () => {
    const [row] = calendarDiscoveryRows({
      calendars: [calendars[1]],
      existingModes: new Map([["shared", "blocking"]]),
      existingSemanticRoles: new Map([["shared", "none"]]),
      googleAccountId: "account-id",
      ownerUserId: "owner-id",
    });

    expect(row).toMatchObject({ is_blocking: true, semantic_role: "none" });
  });
});
