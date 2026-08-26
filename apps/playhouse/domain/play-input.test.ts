import { describe, expect, it } from "vitest";

import { isIsoCalendarDate, parsePlayInput } from "./play-input";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const values = {
    basketId: "",
    branch: "Life",
    durationMinutes: "30",
    note: "Bring the notes",
    place: "Office",
    placementKind: "calendar",
    playType: "normal",
    pushRule: "weekdays",
    scheduledDate: "2026-08-26",
    title: "Plan the weekend",
    url: "https://example.com/plan",
    ...overrides,
  };

  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

describe("Play input validation", () => {
  it("accepts a calendar-placed Normal Play", () => {
    expect(parsePlayInput(form())).toEqual({
      data: {
        branch: "Life",
        durationMinutes: 30,
        note: "Bring the notes",
        place: "Office",
        placement: { kind: "calendar", scheduledDate: "2026-08-26" },
        playType: "normal",
        pushRule: "weekdays",
        title: "Plan the weekend",
        url: "https://example.com/plan",
      },
      success: true,
    });
  });

  it("accepts an explicit Basket placement", () => {
    const result = parsePlayInput(
      form({
        basketId: "11111111-1111-4111-8111-111111111111",
        placementKind: "basket",
        scheduledDate: "",
      }),
    );

    expect(result).toMatchObject({
      data: {
        placement: {
          basketId: "11111111-1111-4111-8111-111111111111",
          kind: "basket",
        },
      },
      success: true,
    });
  });

  it("rejects simultaneous date and Basket placement", () => {
    const result = parsePlayInput(
      form({
        basketId: "11111111-1111-4111-8111-111111111111",
      }),
    );

    expect(result).toMatchObject({
      errors: { placement: expect.any(String) },
      success: false,
    });
  });

  it("rejects missing or invalid placement", () => {
    expect(parsePlayInput(form({ scheduledDate: "2026-02-30" }))).toMatchObject({
      errors: { scheduledDate: expect.any(String) },
      success: false,
    });
    expect(parsePlayInput(form({ placementKind: "unknown" }))).toMatchObject({
      errors: { placement: expect.any(String) },
      success: false,
    });
  });

  it("clears duration while a Play is a Reminder", () => {
    expect(parsePlayInput(form({ playType: "reminder" }))).toMatchObject({
      data: { durationMinutes: null, playType: "reminder" },
      success: true,
    });
  });

  it("validates duration and URL limits", () => {
    expect(parsePlayInput(form({ durationMinutes: "2.5" }))).toMatchObject({
      errors: { durationMinutes: expect.any(String) },
      success: false,
    });
    expect(parsePlayInput(form({ url: "javascript:alert(1)" }))).toMatchObject({
      errors: { url: expect.any(String) },
      success: false,
    });
  });

  it("recognizes only real ISO calendar dates", () => {
    expect(isIsoCalendarDate("2028-02-29")).toBe(true);
    expect(isIsoCalendarDate("2027-02-29")).toBe(false);
    expect(isIsoCalendarDate("08/26/2026")).toBe(false);
  });
});
