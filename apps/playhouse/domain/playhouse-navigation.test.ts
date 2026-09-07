import { describe, expect, it } from "vitest";

import {
  CALENDAR_VIEWS,
  addCalendarDays,
  calendarDateHref,
  friendlyCalendarDate,
  isSelectableCalendarDate,
} from "./playhouse-navigation";

describe("PlayHouse calendar navigation", () => {
  it("places Go to Date after Tomorrow and before the range views", () => {
    expect(CALENDAR_VIEWS.map((view) => view.label)).toEqual([
      "Today",
      "Tomorrow",
      "Go to Date",
      "Next 7 days",
      "All Plays",
    ]);
  });

  it("moves by local calendar days without relying on UTC instants", () => {
    expect(addCalendarDays("2026-09-08", -1)).toBe("2026-09-07");
    expect(addCalendarDays("2026-09-08", 1)).toBe("2026-09-09");
    expect(addCalendarDays("2026-03-08", -1)).toBe("2026-03-07");
    expect(addCalendarDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addCalendarDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("uses canonical Today, Tomorrow, and arbitrary-date URLs", () => {
    expect(calendarDateHref("2026-09-06", "2026-09-06")).toBe("/?view=today");
    expect(calendarDateHref("2026-09-07", "2026-09-06")).toBe("/?view=tomorrow");
    expect(calendarDateHref("2026-09-21", "2026-09-06")).toBe("/?date=2026-09-21");
  });

  it("allows local Today and future dates but rejects past dates", () => {
    expect(isSelectableCalendarDate("2026-09-05", "2026-09-06")).toBe(false);
    expect(isSelectableCalendarDate("2026-09-06", "2026-09-06")).toBe(true);
    expect(isSelectableCalendarDate("2026-09-08", "2026-09-06")).toBe(true);
  });

  it("formats picker and heading labels from date-only calendar values", () => {
    expect(friendlyCalendarDate("2026-09-21")).toBe("Monday, September 21");
    expect(friendlyCalendarDate("2026-09-21", true)).toBe("Mon, Sep 21");
  });
});
