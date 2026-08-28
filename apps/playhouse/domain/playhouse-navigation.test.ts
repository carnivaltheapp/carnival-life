import { describe, expect, it } from "vitest";

import { CALENDAR_VIEWS } from "./playhouse-navigation";

describe("PlayHouse calendar navigation", () => {
  it("places All Plays directly under Next 7 days", () => {
    expect(CALENDAR_VIEWS.map((view) => view.label)).toEqual([
      "Today",
      "Tomorrow",
      "Next 7 days",
      "All Plays",
    ]);
  });
});
