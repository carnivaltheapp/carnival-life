import { describe, expect, it } from "vitest";

import type { BasketSummary, PlayListItem } from "./play";
import {
  playMatchesSearch,
  searchableMetadataText,
  searchPlays,
} from "./play-search";

const baskets: BasketSummary[] = [
  { id: "soon", name: "Soon", slug: "soon", sortOrder: 20 },
  { id: "backlog", name: "Backlog", slug: "backlog", sortOrder: 10 },
];

function play(overrides: Partial<PlayListItem> = {}): PlayListItem {
  return {
    basketId: null,
    branch: "BlueField Law",
    durationMinutes: 30,
    id: "play",
    legacyTaskType: "H",
    nextPlayId: null,
    note: "Send the invoice",
    place: "Office",
    playerContactId: "contact",
    playerDisplayName: "Jitin Example",
    playType: "normal",
    pushRule: "everyday",
    scheduledDate: "2026-09-06",
    searchableText: ["jitin@example.test"],
    sortOrder: 100,
    sourceType: "user",
    title: "Review contract",
    url: "https://example.test/contract",
    ...overrides,
  };
}

describe("Global Play Search", () => {
  it.each([
    ["review", "Description"],
    ["JITIN", "Player"],
    ["bluefield", "Branch"],
    ["office", "Place"],
    ["invoice", "note"],
    ["jitin@example", "email"],
    ["example.test/contract", "URL"],
  ])("matches case-insensitive %s text from %s", (query) => {
    expect(playMatchesSearch(play(), query)).toBe(true);
  });

  it("requires every query token and excludes nonmatches", () => {
    expect(playMatchesSearch(play(), "jitin contract")).toBe(true);
    expect(playMatchesSearch(play(), "jitin missing")).toBe(false);
  });

  it("extracts only explicit email text from source metadata", () => {
    expect(searchableMetadataText({
      legacy_source: { email: "legacy@example.test", note: "not duplicated" },
      token: "must-not-be-searchable",
    })).toEqual(["legacy@example.test"]);
  });

  it("includes dated and Basket Plays of every rank and legacy type", () => {
    const plays = [
      play({ id: "a", legacyTaskType: "A", title: "Needle appointment" }),
      play({ id: "h", legacyTaskType: "H", title: "Needle headline" }),
      play({ id: "s", legacyTaskType: "S", playType: "reminder", title: "Needle reminder" }),
      play({ basketId: "backlog", id: "u", legacyTaskType: "U", scheduledDate: null, title: "Needle basket" }),
      play({ basketId: "soon", id: "p", legacyTaskType: "P", scheduledDate: null, title: "Needle legacy" }),
    ];
    expect(searchPlays(plays, "needle", baskets).map((item) => item.id)).toEqual([
      "a", "h", "s", "u", "p",
    ]);
  });

  it("sorts real dates first, then Baskets deterministically, then rank and priority", () => {
    const plays = [
      play({ basketId: "soon", id: "soon", scheduledDate: null }),
      play({ id: "tomorrow-a", legacyTaskType: "A", scheduledDate: "2026-09-07" }),
      play({ basketId: "backlog", id: "backlog-s", legacyTaskType: "S", playType: "reminder", scheduledDate: null }),
      play({ id: "today-s", legacyTaskType: "S", playType: "reminder", sortOrder: 10 }),
      play({ id: "today-h-later", sortOrder: 200 }),
      play({ id: "today-a", legacyTaskType: "A", sortOrder: 500 }),
      play({ id: "today-h-first", sortOrder: 100 }),
      play({ basketId: "backlog", id: "backlog-a", legacyTaskType: "A", scheduledDate: null }),
    ];
    expect(searchPlays(plays, "", baskets).map((item) => item.id)).toEqual([
      "today-a", "today-h-first", "today-h-later", "today-s",
      "tomorrow-a", "backlog-a", "backlog-s", "soon",
    ]);
  });
});
