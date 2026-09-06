import { describe, expect, it } from "vitest";

import { mongoPlayType } from "../lib/playhouse/mongo-play-mapping";
import { PLAY_VISUALS, playVisualForPlay, playVisualForType } from "./play-visual";

describe("Play visual classification", () => {
  it("classifies Normal Plays as orange Headline indicators", () => {
    expect(playVisualForType("normal")).toEqual({
      className: "playVisual--headline",
      label: "Headline",
      markerClassName: "playTypeMarker--headline",
      visualType: "headline",
    });
  });

  it("classifies Reminder Plays as green Reminder indicators", () => {
    expect(playVisualForType("reminder")).toEqual({
      className: "playVisual--reminder",
      label: "Reminder",
      markerClassName: "playTypeMarker--reminder",
      visualType: "reminder",
    });
  });

  it("keeps every legacy non-S value in the existing Headline classification", () => {
    for (const taskType of ["H", "U", "P", "", null, "future-value"]) {
      expect(playVisualForType(mongoPlayType(taskType), taskType)).toBe(
        PLAY_VISUALS.headline,
      );
    }
    expect(playVisualForType(mongoPlayType("S"), "S")).toBe(PLAY_VISUALS.reminder);
  });

  it("classifies legacy A as a red Appointment without changing its Normal domain type", () => {
    const domainType = mongoPlayType("A");
    expect(domainType).toBe("normal");
    expect(playVisualForType(domainType, "A")).toBe(PLAY_VISUALS.appointment);
  });

  it("recognizes an imported Appointment from Supabase source metadata", () => {
    expect(playVisualForPlay({
      playType: "normal",
      sourceMetadata: { legacy_source: { task_type: "A" } },
    })).toBe(PLAY_VISUALS.appointment);
  });

  it("is deterministic across views and unrelated move/reorder state", () => {
    const visual = playVisualForType("reminder");
    expect(playVisualForType("reminder")).toBe(visual);
    expect(playVisualForType("reminder")).toBe(PLAY_VISUALS.reminder);
  });
});
