import { describe, expect, it } from "vitest";

import type { PlayListItem } from "./play";
import { sortPlaysForGrid } from "./play-grid-sort";

function play(
  id: string,
  values: Partial<Pick<
    PlayListItem,
    "branch" | "gmailThreadId" | "playerDisplayName" | "sortOrder" | "title" | "url"
  >> = {},
): PlayListItem {
  return {
    basketId: null,
    branch: values.branch ?? null,
    durationMinutes: null,
    gmailThreadId: values.gmailThreadId ?? null,
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
    url: values.url ?? null,
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

  it.each([
    ["gmail", "asc", ["gmail-1", "gmail-2", "plain-1", "plain-2"]],
    ["gmail", "desc", ["plain-1", "plain-2", "gmail-1", "gmail-2"]],
    ["url", "asc", ["url-1", "url-2", "plain-1", "plain-2"]],
    ["url", "desc", ["plain-1", "plain-2", "url-1", "url-2"]],
  ] as const)("sorts %s linkage %s while preserving stable group order", (
    column,
    direction,
    expected,
  ) => {
    const binaryPlays = [
      play("plain-1"),
      play(column === "gmail" ? "gmail-1" : "url-1", column === "gmail"
        ? { gmailThreadId: "thread-1" }
        : { url: "https://one.example" }),
      play("plain-2", column === "url" ? { url: "not-a-usable-url" } : {}),
      play(column === "gmail" ? "gmail-2" : "url-2", column === "gmail"
        ? { gmailThreadId: "thread-2" }
        : { url: "http://two.example" }),
    ];

    expect(sortPlaysForGrid(binaryPlays, { column, direction }).map(({ id }) => id))
      .toEqual(expected);
  });
});
