import { describe, expect, it } from "vitest";

import type { PlayListItem } from "./play";
import { optimisticallyRepositionPlays } from "./play-optimistic-reorder";

function play(
  id: string,
  playType: PlayListItem["playType"] = "normal",
  legacyTaskType: string | null = "H",
): PlayListItem {
  return {
    basketId: null,
    branch: null,
    durationMinutes: 30,
    id,
    legacyTaskType,
    nextPlayId: null,
    note: null,
    place: "Office",
    playerContactId: null,
    playerDisplayName: null,
    playType,
    pushRule: "everyday",
    scheduledDate: "2026-09-08",
    sortOrder: Number(id.replace(/\D/g, "")),
    sourceType: "user",
    title: id,
    url: null,
  };
}

describe("optimisticallyRepositionPlays", () => {
  it("moves one row immediately while preserving stable Play objects", () => {
    const plays = [play("p1"), play("p2"), play("p3"), play("p4")];
    const result = optimisticallyRepositionPlays({
      beforePlayId: "p2",
      keepInCurrentView: true,
      playIds: ["p4"],
      plays,
    });

    expect(result.map(({ id }) => id)).toEqual(["p1", "p4", "p2", "p3"]);
    expect(result[0]).toBe(plays[0]);
    expect(result[2]).toBe(plays[1]);
    expect(plays.map(({ id }) => id)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("preserves selected-row order and authoritative rank grouping", () => {
    const plays = [
      play("a1", "normal", "A"),
      play("h1"),
      play("h2"),
      play("h3"),
      play("s1", "reminder", "S"),
    ];
    const result = optimisticallyRepositionPlays({
      beforePlayId: "h1",
      keepInCurrentView: true,
      playIds: ["h2", "h3"],
      plays,
    });

    expect(result.map(({ id }) => id)).toEqual(["a1", "h2", "h3", "h1", "s1"]);
  });

  it("removes moved rows immediately when their destination is another view", () => {
    const plays = [play("p1"), play("p2"), play("p3")];
    expect(optimisticallyRepositionPlays({
      beforePlayId: null,
      keepInCurrentView: false,
      playIds: ["p2"],
      plays,
    }).map(({ id }) => id)).toEqual(["p1", "p3"]);
  });

  it("retains the untouched input snapshot for failure rollback", () => {
    const previous = [play("p1"), play("p2"), play("p3")];
    const optimistic = optimisticallyRepositionPlays({
      beforePlayId: "p1",
      keepInCurrentView: true,
      playIds: ["p3"],
      plays: previous,
    });

    expect(optimistic.map(({ id }) => id)).toEqual(["p3", "p1", "p2"]);
    expect(previous.map(({ id }) => id)).toEqual(["p1", "p2", "p3"]);
  });
});
