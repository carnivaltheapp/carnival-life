import { describe, expect, it } from "vitest";

import type { PlayListItem } from "./play";
import { sortPlaysForGrid } from "./play-grid-sort";

function play(
  id: string,
  values: Partial<Pick<PlayListItem, "branch" | "playerDisplayName" | "sortOrder" | "title">> = {},
): PlayListItem {
  return {
    basketId: null,
    branch: values.branch ?? null,
    durationMinutes: null,
    id,
    legacyTaskType: "H",
    nextPlayId: null,
    note: null,
    place: null,
    playerContactId: null,
    playerDisplayName: values.playerDisplayName ?? null,
    playType: "normal",
    pushRule: "everyday",
    scheduledDate: "2026-09-07",
    sortOrder: values.sortOrder ?? 0,
    sourceType: "user",
    title: values.title ?? id,
    url: null,
  };
}

describe("Play grid sorting", () => {
  const plays = [
    play("zulu", { branch: "C:\\Google Drive\\Zulu", playerDisplayName: null, sortOrder: 10 }),
    play("alpha", { branch: "C:\\Google Drive\\Alpha", playerDisplayName: "Blair", sortOrder: 20 }),
    play("middle", { branch: null, playerDisplayName: "alex", sortOrder: 30 }),
  ];

  it("keeps the repository order unchanged until a custom sort is chosen", () => {
    expect(sortPlaysForGrid(plays, null)).toBe(plays);
    expect(plays.map(({ sortOrder }) => sortOrder)).toEqual([10, 20, 30]);
  });

  it.each([
    ["assignee", "asc", ["middle", "alpha", "zulu"]],
    ["assignee", "desc", ["alpha", "middle", "zulu"]],
    ["description", "asc", ["alpha", "middle", "zulu"]],
    ["description", "desc", ["zulu", "middle", "alpha"]],
    ["branch", "asc", ["alpha", "zulu", "middle"]],
    ["branch", "desc", ["zulu", "alpha", "middle"]],
  ] as const)("sorts %s %s without changing priority", (column, direction, expected) => {
    const result = sortPlaysForGrid(plays, { column, direction });
    expect(result.map(({ id }) => id)).toEqual(expected);
    expect(plays.map(({ sortOrder }) => sortOrder)).toEqual([10, 20, 30]);
  });
});
