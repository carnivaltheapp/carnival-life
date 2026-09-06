import { describe, expect, it } from "vitest";

import { mongoPlayType } from "../lib/playhouse/mongo-play-mapping";
import { PLAY_VISUALS, playVisualForType } from "./play-visual";

describe("Play visual classification", () => {
  it("classifies Normal Plays as orange Headline indicators", () => {
    expect(playVisualForType("normal")).toEqual({
      className: "playTypeMarker--headline",
      label: "Headline",
      visualType: "headline",
    });
  });

  it("classifies Reminder Plays as green Reminder indicators", () => {
    expect(playVisualForType("reminder")).toEqual({
      className: "playTypeMarker--reminder",
      label: "Reminder",
      visualType: "reminder",
    });
  });

  it("keeps every legacy non-S value in the existing Headline classification", () => {
    for (const taskType of ["H", "U", "P", "A", "", null, "future-value"]) {
      expect(playVisualForType(mongoPlayType(taskType))).toBe(PLAY_VISUALS.headline);
    }
    expect(playVisualForType(mongoPlayType("S"))).toBe(PLAY_VISUALS.reminder);
  });

  it("reserves a red accessible visual definition for a future authoritative Appointment type", () => {
    expect(PLAY_VISUALS.appointment).toEqual({
      className: "playTypeMarker--appointment",
      label: "Appointment",
      visualType: "appointment",
    });
  });

  it("is deterministic across views and unrelated move/reorder state", () => {
    const visual = playVisualForType("reminder");
    expect(playVisualForType("reminder")).toBe(visual);
    expect(playVisualForType("reminder")).toBe(PLAY_VISUALS.reminder);
  });
});
