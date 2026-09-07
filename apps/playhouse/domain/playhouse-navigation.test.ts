import { describe, expect, it } from "vitest";

import {
  CALENDAR_VIEWS,
  addCalendarDays,
  calendarDateHref,
  friendlyCalendarDate,
  isSelectableCalendarDate,
  rollingCalendarDates,
} from "./playhouse-navigation";

describe("PlayHouse calendar navigation", () => {
  it("keeps Go to Date before the range views", () => {
    expect(CALENDAR_VIEWS.map((view) => view.label)).toEqual([
      "Go to Date",
      "Next 7 Days",
      "All Plays",
    ]);
  });

  it("builds exactly seven dated links before Go to Date", () => {
    const dates = rollingCalendarDates("2026-09-07");
    expect(dates).toEqual([
      { date: "2026-09-07", label: "Today Sep 7", marker: "●" },
      { date: "2026-09-08", label: "Tomorrow Sep 8", marker: "○" },
      { date: "2026-09-09", label: "Wed Sep 9", marker: "○" },
      { date: "2026-09-10", label: "Thu Sep 10", marker: "○" },
      { date: "2026-09-11", label: "Fri Sep 11", marker: "○" },
      { date: "2026-09-12", label: "Sat Sep 12", marker: "○" },
      { date: "2026-09-13", label: "Sun Sep 13", marker: "○" },
    ]);
    expect([...dates.map(({ label }) => label), ...CALENDAR_VIEWS.map(({ label }) => label)][7])
      .toBe("Go to Date");
    expect(dates.map(({ date }) => calendarDateHref(date, "2026-09-07"))).toEqual([
      "/?view=today",
      "/?view=tomorrow",
      "/?date=2026-09-09",
      "/?date=2026-09-10",
      "/?date=2026-09-11",
      "/?date=2026-09-12",
      "/?date=2026-09-13",
    ]);
  });

  it("rolls the local date-only window across month and year boundaries", () => {
    expect(rollingCalendarDates("2026-09-28").map(({ date }) => date)).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01",
      "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    expect(rollingCalendarDates("2026-12-29").map(({ date }) => date)).toEqual([
      "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01",
      "2027-01-02", "2027-01-03", "2027-01-04",
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
