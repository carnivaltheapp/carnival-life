import { describe, expect, it } from "vitest";

import type { BasketSummary } from "../../domain/play";
import { addDays, dateInTimeZone, resolveSelectedView } from "./data";

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
