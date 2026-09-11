import { describe, expect, it } from "vitest";

import type { PlayListItem } from "./play";
import { sortChronologicalPlays } from "./play-sort";

function play({
  date = "2026-09-06",
  id,
  order,
  taskType,
}: {
  date?: string;
  id: string;
  order: number;
  taskType: string;
}): PlayListItem {
  return {
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
    sortOrder: order,
    sourceType: "user",
    title: id,
    url: null,
  };
}

describe("chronological Play sorting", () => {
  it("orders A, Headline, then S on the same date", () => {
    const result = sortChronologicalPlays([
      play({ id: "headline", order: 100, taskType: "H" }),
      play({ id: "reminder", order: 100, taskType: "S" }),
      play({ id: "appointment", order: 100, taskType: "A" }),
    ]);
    expect(result.map((item) => item.id)).toEqual([
      "appointment", "headline", "reminder",
    ]);
  });

  it("places whole-day Place context before Appointment, Headline, and Reminder", () => {
    const place = { ...play({ id: "place", order: 999, taskType: "" }), contextType: "place" as const };
    expect(sortChronologicalPlays([
      play({ id: "headline", order: 1, taskType: "H" }),
      play({ id: "appointment", order: 1, taskType: "A" }),
      play({ id: "reminder", order: 1, taskType: "S" }),
      place,
    ]).map(({ id }) => id)).toEqual(["place", "appointment", "headline", "reminder"]);
  });

  it("groups legacy U/H/P as Headlines and preserves priority within every rank", () => {
    const result = sortChronologicalPlays([
      play({ id: "s-later", order: 300, taskType: "S" }),
      play({ id: "u-later", order: 300, taskType: "U" }),
      play({ id: "a-later", order: 300, taskType: "A" }),
      play({ id: "h-first", order: 100, taskType: "H" }),
      play({ id: "p-middle", order: 200, taskType: "P" }),
      play({ id: "a-first", order: 100, taskType: "A" }),
      play({ id: "s-first", order: 100, taskType: "S" }),
    ]);
    expect(result.map((item) => item.id)).toEqual([
      "a-first", "a-later",
      "h-first", "p-middle", "u-later",
      "s-first", "s-later",
    ]);
  });

  it("keeps date primary before rank", () => {
    const result = sortChronologicalPlays([
      play({ date: "2026-09-07", id: "mon-a", order: 1, taskType: "A" }),
      play({ id: "sun-s", order: 1, taskType: "S" }),
      play({ date: "2026-09-07", id: "mon-s", order: 1, taskType: "S" }),
      play({ id: "sun-h", order: 1, taskType: "H" }),
      play({ date: "2026-09-07", id: "mon-h", order: 1, taskType: "H" }),
      play({ id: "sun-a", order: 1, taskType: "A" }),
    ]);
    expect(result.map((item) => item.id)).toEqual([
      "sun-a", "sun-h", "sun-s", "mon-a", "mon-h", "mon-s",
    ]);
  });

  it("places a promoted Reminder first among Headlines but after Appointments", () => {
    const promoted = play({ id: "promoted", order: 100, taskType: "S" });
    promoted.playType = "normal";
    expect(sortChronologicalPlays([
      play({ id: "headline", order: 200, taskType: "H" }),
      play({ id: "appointment", order: 500, taskType: "A" }),
      play({ id: "reminder", order: 50, taskType: "S" }),
      promoted,
    ]).map((item) => item.id)).toEqual([
      "appointment", "promoted", "headline", "reminder",
    ]);
  });
});
