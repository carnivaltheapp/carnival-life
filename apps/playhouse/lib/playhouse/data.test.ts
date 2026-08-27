import { describe, expect, it } from "vitest";

import type { BasketSummary, PlayListItem } from "../../domain/play";
import { addDays, dateInTimeZone, resolveSelectedView, sortPlaysForDisplay } from "./data";

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
      label: "September 14, 2026",
      startDate: "2026-09-14",
    });
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
  it("shows Normal Plays before Reminders while preserving repository order", () => {
    const play = (id: string, playType: PlayListItem["playType"]): PlayListItem => ({
      basketId: null,
      branch: null,
      durationMinutes: null,
      id,
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
      play("reminder-1", "reminder"),
      play("normal-1", "normal"),
      play("reminder-2", "reminder"),
      play("normal-2", "normal"),
    ];

    expect(sortPlaysForDisplay(repositoryOrder).map((item) => item.id)).toEqual([
      "normal-1",
      "normal-2",
      "reminder-1",
      "reminder-2",
    ]);
  });
});
