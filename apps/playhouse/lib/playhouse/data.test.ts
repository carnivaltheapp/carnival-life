import { describe, expect, it } from "vitest";

import type { BasketSummary, PlayListItem } from "../../domain/play";
import {
  addDays,
  dateInTimeZone,
  lifecycleViewHref,
  retainLifecycleInHref,
  resolvePlayLifecycle,
  resolveSelectedView,
  sortPlaysForDisplay,
  sortPlaysForSelectedView,
} from "./data";

const baskets: BasketSummary[] = [
  { id: "basket-1", name: "Backlog", slug: "backlog", sortOrder: 10 },
];

describe("PlayHouse destination resolution", () => {
  it("resolves a live Basket by its database slug", () => {
    expect(
      resolveSelectedView({
        basketSlug: "backlog",
        baskets,
        now: new Date("2026-08-25T18:00:00Z"),
        timeZone: "America/Los_Angeles",
      }),
    ).toMatchObject({ kind: "basket", label: "Backlog" });
  });

  it("falls back to Today for an unknown Basket", () => {
    expect(
      resolveSelectedView({
        basketSlug: "not-a-basket",
        baskets,
        now: new Date("2026-08-25T18:00:00Z"),
        timeZone: "America/Los_Angeles",
      }),
    ).toEqual({
      endDate: "2026-08-25",
      key: "today",
      kind: "calendar",
      label: "Today",
      startDate: "2026-08-25",
    });
  });

  it("builds an inclusive seven-day range", () => {
    expect(
      resolveSelectedView({
        baskets,
        now: new Date("2026-08-25T18:00:00Z"),
        timeZone: "America/Los_Angeles",
        view: "week",
      }),
    ).toMatchObject({ endDate: "2026-08-31", startDate: "2026-08-25" });
  });

  it("resolves All Plays with Today as its new-Play default", () => {
    expect(
      resolveSelectedView({
        baskets,
        now: new Date("2026-08-25T18:00:00Z"),
        timeZone: "America/Los_Angeles",
        view: "all",
      }),
    ).toEqual({
      defaultDate: "2026-08-25",
      key: "all",
      kind: "all",
      label: "All Plays",
    });
  });

  it("resolves an explicit date used after Done/Create navigation", () => {
    expect(
      resolveSelectedView({
        baskets,
        date: "2026-09-14",
        timeZone: "America/Los_Angeles",
      }),
    ).toMatchObject({
      endDate: "2026-09-14",
      key: "date",
      label: "Monday, September 14",
      startDate: "2026-09-14",
    });
  });
});

describe("PlayHouse lifecycle views", () => {
  const dateScope = {
    endDate: "2026-09-25",
    key: "date" as const,
    kind: "calendar" as const,
    label: "Friday, September 25",
    startDate: "2026-09-25",
  };

  it("keeps Date scope while toggling Done, Trash, and Active", () => {
    expect(lifecycleViewHref({ lifecycle: "done", searchQuery: "", selectedView: dateScope }))
      .toBe("/?date=2026-09-25&lifecycle=done");
    expect(lifecycleViewHref({ lifecycle: "trash", searchQuery: "", selectedView: dateScope }))
      .toBe("/?date=2026-09-25&lifecycle=trash");
    expect(lifecycleViewHref({ lifecycle: "active", searchQuery: "", selectedView: dateScope }))
      .toBe("/?date=2026-09-25");
  });

  it("keeps Basket, exact seven-day, and All Plays scopes", () => {
    expect(lifecycleViewHref({
      lifecycle: "done",
      searchQuery: "",
      selectedView: { basket: baskets[0], kind: "basket", label: "Backlog" },
    })).toBe("/?basket=backlog&lifecycle=done");
    expect(lifecycleViewHref({
      lifecycle: "trash",
      searchQuery: "",
      selectedView: {
        endDate: "2026-08-31",
        key: "week",
        kind: "calendar",
        label: "Next 7 days",
        startDate: "2026-08-25",
      },
    })).toBe("/?view=week&lifecycle=trash");
    expect(lifecycleViewHref({
      lifecycle: "done",
      searchQuery: "",
      selectedView: {
        defaultDate: "2026-08-25",
        key: "all",
        kind: "all",
        label: "All Plays",
      },
    })).toBe("/?view=all&lifecycle=done");
  });

  it("preserves search and safely resolves lifecycle input", () => {
    expect(lifecycleViewHref({ lifecycle: "trash", searchQuery: "quarterly plan", selectedView: dateScope }))
      .toContain("q=quarterly+plan");
    expect(resolvePlayLifecycle("done")).toBe("done");
    expect(resolvePlayLifecycle("trash")).toBe("trash");
    expect(resolvePlayLifecycle("unknown")).toBe("active");
    expect(retainLifecycleInHref("/?view=week", "done"))
      .toBe("/?view=week&lifecycle=done");
    expect(retainLifecycleInHref("/?basket=soon", "trash"))
      .toBe("/?basket=soon&lifecycle=trash");
    expect(retainLifecycleInHref("/?view=all", "active")).toBe("/?view=all");
  });
});

describe("calendar date helpers", () => {
  it("uses the user timezone at a UTC date boundary", () => {
    const instant = new Date("2026-08-26T02:00:00Z");
    expect(dateInTimeZone(instant, "America/Los_Angeles")).toBe("2026-08-25");
    expect(dateInTimeZone(instant, "UTC")).toBe("2026-08-26");
  });

  it("adds days safely across month boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });
});

describe("Play display sorting", () => {
  it("groups Appointments, Headlines, then Reminders while preserving priority order", () => {
    const play = (
      id: string,
      playType: PlayListItem["playType"],
      taskType: string,
    ): PlayListItem => ({
      basketId: null,
      branch: null,
      durationMinutes: null,
      id,
      legacyTaskType: taskType,
      nextPlayId: null,
      note: null,
      place: null,
      playerContactId: null,
      playerDisplayName: null,
      playType,
      pushRule: "everyday",
      scheduledDate: "2026-08-27",
      sourceType: "user",
      title: id,
      url: null,
    });
    const repositoryOrder = [
      play("reminder-1", "reminder", "S"),
      play("headline-1", "normal", "H"),
      play("appointment-1", "normal", "A"),
      play("reminder-2", "reminder", "S"),
      play("headline-2", "normal", "U"),
      play("appointment-2", "normal", "A"),
    ];

    expect(sortPlaysForDisplay(repositoryOrder).map((item) => item.id)).toEqual([
      "appointment-1",
      "appointment-2",
      "headline-1",
      "headline-2",
      "reminder-1",
      "reminder-2",
    ]);
  });

  it("uses chronological rank sorting for All Plays and Next 7 Days", () => {
    const base = (id: string, date: string, taskType: string): PlayListItem => ({
      basketId: null,
      branch: null,
      durationMinutes: null,
      id,
      legacyTaskType: taskType,
      nextPlayId: null,
      note: null,
      place: null,
      playerContactId: null,
      playerDisplayName: null,
      playType: taskType === "S" ? "reminder" : "normal",
      pushRule: "everyday",
      scheduledDate: date,
      sortOrder: 100,
      sourceType: "user",
      title: id,
      url: null,
    });
    const plays = [
      base("monday-appointment", "2026-09-07", "A"),
      base("sunday-reminder", "2026-09-06", "S"),
      base("sunday-headline", "2026-09-06", "H"),
      base("sunday-appointment", "2026-09-06", "A"),
    ];
    const expected = [
      "sunday-appointment", "sunday-headline", "sunday-reminder", "monday-appointment",
    ];

    expect(sortPlaysForSelectedView(plays, {
      defaultDate: "2026-09-06",
      key: "all",
      kind: "all",
      label: "All Plays",
    }).map((item) => item.id)).toEqual(expected);
    expect(sortPlaysForSelectedView(plays, {
      endDate: "2026-09-12",
      key: "week",
      kind: "calendar",
      label: "Next 7 days",
      startDate: "2026-09-06",
    }).map((item) => item.id)).toEqual(expected);
  });
});
