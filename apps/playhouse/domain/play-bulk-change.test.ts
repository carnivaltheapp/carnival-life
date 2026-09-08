import { describe, expect, it } from "vitest";

import type { PlayListItem } from "./play";
import { isBulkSelectablePlay, optimisticallyApplyBulkChange } from "./play-bulk-change";

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

  it("applies canonical Push and Duration values only to selected Plays", () => {
    const plays = [play("one", "H", "normal"), play("two", "S", "reminder")];
    const pushed = optimisticallyApplyBulkChange(
      plays,
      new Set(["one"]),
      { kind: "push", pushRule: "weekdays" },
      true,
    );
    const duration = optimisticallyApplyBulkChange(
      pushed,
      new Set(["one"]),
      { durationMinutes: 90, kind: "duration" },
      true,
    );
    expect(duration[0]).toMatchObject({ durationMinutes: 90, pushRule: "weekdays" });
    expect(duration[1]).toBe(plays[1]);
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
      { kind: "rank", playType: "reminder", reminderDate: "2026-09-08" },
      true,
    );
    expect(reminded[0]).toBe(appointment);
    expect(reminded[1]).toMatchObject({ legacyTaskType: "S", playType: "reminder" });
    const restored = optimisticallyApplyBulkChange(
      reminded,
      new Set(["h"]),
      { kind: "rank", playType: "normal", reminderDate: "2026-09-08" },
      true,
    );
    expect(restored[1]).toMatchObject({ legacyTaskType: "H", playType: "normal" });
  });

  it("places a Basket Play on the Reminder context date and removes it from that Basket view", () => {
    const basketPlay = {
      ...play("basket", "H", "normal"),
      basketId: "backlog",
      scheduledDate: null,
    };
    expect(optimisticallyApplyBulkChange(
      [basketPlay],
      new Set(["basket"]),
      { kind: "rank", playType: "reminder", reminderDate: "2026-09-12" },
      false,
    )).toEqual([]);
    expect(optimisticallyApplyBulkChange(
      [basketPlay],
      new Set(["basket"]),
      { kind: "rank", playType: "reminder", reminderDate: "2026-09-12" },
      true,
    )[0]).toMatchObject({
      basketId: null,
      legacyTaskType: "S",
      scheduledDate: "2026-09-12",
    });
  });
});
