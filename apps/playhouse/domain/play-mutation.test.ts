import { describe, expect, it } from "vitest";

import { capturePlayMutationValues } from "./play-mutation";

describe("Play mutation values", () => {
  it("captures entered form values for validation-error redisplay", () => {
    const formData = new FormData();
    const values = {
      basketId: "",
      branch: "Personal",
      durationMinutes: "45",
      note: "Keep this note",
      place: "office",
      placementKind: "calendar",
      playType: "normal",
      playerContactId: "33333333-3333-4333-8333-333333333333",
      pushRule: "weekdays",
      scheduledDate: "2026-08-26",
      title: "Keep this title",
      url: "https://example.com/keep-this",
    };
    Object.entries(values).forEach(([field, value]) => formData.set(field, value));
    formData.set("playId", "22222222-2222-4222-8222-222222222222");

    expect(capturePlayMutationValues(formData)).toEqual(values);
  });
});
