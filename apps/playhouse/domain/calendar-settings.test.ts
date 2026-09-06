import { describe, expect, it } from "vitest";

import { calendarDiscoveryRows } from "./calendar-settings";

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
      googleAccountId: "account-id",
      ownerUserId: "owner-id",
    });

    expect(rows.map((row) => [row.provider_calendar_id, row.is_blocking])).toEqual([
      ["primary", false],
      ["shared", true],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/token|credential|secret/i);
  });
});
