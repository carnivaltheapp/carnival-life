import { describe, expect, it } from "vitest";

import type { PlayListItem } from "./play";
import {
  isBulkSelectablePlay,
  optimisticallyApplyBulkChange,
  optimisticallyFlipPlayRank,
} from "./play-bulk-change";

function play(id: string, taskType: string, playType: PlayListItem["playType"]): PlayListItem {
  return {
    basketId: null,
    branch: null,
    durationMinutes: 30,
    id,
    legacyTaskType: taskType,
    nextPlayId: null,
    note: null,
    place: "Office",
    playerContactId: null,
    playerDisplayName: null,
    playType,
    pushRule: "everyday",
    scheduledDate: "2026-09-08",
    sourceType: "user",
    title: id,
    url: null,
  };
}

describe("bulk Play changes", () => {
  it("defensively excludes Appointments", () => {
    const appointment = play("a", "A", "normal");
    const headline = play("h", "H", "normal");
    expect(isBulkSelectablePlay(appointment)).toBe(false);
    expect(isBulkSelectablePlay(headline)).toBe(true);
    const changed = optimisticallyApplyBulkChange(
      [appointment, headline],
      new Set(["a", "h"]),
      { kind: "push", pushRule: "weekends" },
      true,
    );
    expect(changed.map(({ pushRule }) => pushRule)).toEqual(["everyday", "weekends"]);
  });

  it("excludes Place context from Play selection and mutations", () => {
    const place = { ...play("place", "", "normal"), contextType: "place" as const };
    expect(isBulkSelectablePlay(place)).toBe(false);
    expect(optimisticallyApplyBulkChange(
      [place],
      new Set([place.id]),
      { kind: "push", pushRule: "weekends" },
      true,
    )).toEqual([place]);
  });

  it("applies canonical Push values only to selected Plays", () => {
    const plays = [play("one", "H", "normal"), play("two", "S", "reminder")];
    const pushed = optimisticallyApplyBulkChange(
      plays,
      new Set(["one"]),
      { kind: "push", pushRule: "weekdays" },
      true,
    );
    expect(pushed[0]).toMatchObject({ durationMinutes: 30, pushRule: "weekdays" });
    expect(pushed[1]).toBe(plays[1]);
  });

  it("removes selected rows optimistically when a move leaves the view", () => {
    const plays = [play("one", "H", "normal"), play("two", "S", "reminder")];
    expect(optimisticallyApplyBulkChange(
      plays,
      new Set(["one"]),
      { kind: "move", placement: { basketId: "backlog", kind: "basket" } },
      false,
    ).map(({ id }) => id)).toEqual(["two"]);
    expect(plays).toHaveLength(2);
  });

  it("maps Headline and Reminder ranks without changing an Appointment", () => {
    const appointment = play("a", "A", "normal");
    const headline = play("h", "H", "normal");
    const reminded = optimisticallyApplyBulkChange(
      [appointment, headline],
      new Set(["a", "h"]),
      { kind: "rank", playType: "reminder" },
      true,
    );
    expect(reminded[0]).toBe(appointment);
    expect(reminded[1]).toMatchObject({ legacyTaskType: "S", playType: "reminder" });
    const restored = optimisticallyApplyBulkChange(
      reminded,
      new Set(["h"]),
      { kind: "rank", playType: "normal" },
      true,
    );
    expect(restored[1]).toMatchObject({ legacyTaskType: "H", playType: "normal" });
  });

  it("preserves Basket placement when changing rank", () => {
    const basketPlay = {
      ...play("basket", "H", "normal"),
      basketId: "backlog",
      scheduledDate: null,
    };
    expect(optimisticallyApplyBulkChange(
      [basketPlay],
      new Set(["basket"]),
      { kind: "rank", playType: "reminder" },
      false,
    )[0]).toMatchObject({
      basketId: "backlog",
      legacyTaskType: "S",
      scheduledDate: null,
    });
  });

  it("flips legacy Headlines to the top of Reminders and back to the top of Headlines", () => {
    const appointment = { ...play("a", "A", "normal"), sortOrder: 1 };
    const headline = { ...play("u", "U", "normal"), sortOrder: 30 };
    const otherHeadline = { ...play("h", "H", "normal"), sortOrder: 20 };
    const reminder = { ...play("s", "S", "reminder"), sortOrder: 40 };
    const reminded = optimisticallyFlipPlayRank(
      [appointment, otherHeadline, headline, reminder],
      "u",
      "reminder",
      true,
    );
    expect(reminded.find(({ id }) => id === "u")).toMatchObject({
      basketId: null,
      legacyTaskType: "S",
      playType: "reminder",
      scheduledDate: "2026-09-08",
      sortOrder: 39,
    });

    const restored = optimisticallyFlipPlayRank(
      reminded,
      "u",
      "normal",
      true,
    );
    expect(restored.find(({ id }) => id === "u")).toMatchObject({
      basketId: null,
      legacyTaskType: "H",
      playType: "normal",
      scheduledDate: "2026-09-08",
      sortOrder: 19,
    });
    expect(restored.find(({ id }) => id === "a")).toBe(appointment);
  });

  it("does not flip an Appointment", () => {
    const appointment = play("a", "A", "normal");
    expect(optimisticallyFlipPlayRank(
      [appointment],
      "a",
      "reminder",
      true,
    )).toEqual([appointment]);
  });
});
