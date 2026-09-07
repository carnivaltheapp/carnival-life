import { describe, expect, it } from "vitest";

import {
  promotionOrderUpdates,
  reminderContextDate,
  reminderDateError,
} from "./reminder";

describe("Reminder deadlines", () => {
  it("allows the browser-local context date and rejects earlier dates", () => {
    const today = "2026-09-06";
    expect(reminderDateError(null, today)).toBeTruthy();
    expect(reminderDateError({ kind: "calendar", scheduledDate: "" }, today)).toBeTruthy();
    expect(reminderDateError({ kind: "calendar", scheduledDate: "2026-09-05" }, today)).toBeTruthy();
    expect(reminderDateError({ kind: "calendar", scheduledDate: today }, today)).toBeNull();
    expect(reminderDateError({ kind: "calendar", scheduledDate: "2400-01-11" }, today)).toBeTruthy();
    expect(reminderDateError({ kind: "calendar", scheduledDate: "2026-09-07" }, today)).toBeNull();
  });

  it("uses a displayed single-day date without converting it through UTC", () => {
    expect(reminderContextDate({
      displayedDate: "2026-09-12",
      todayDate: "2026-09-07",
    })).toBe("2026-09-12");
    expect(reminderDateError(
      { kind: "calendar", scheduledDate: "2026-09-11" },
      "2026-09-12",
    )).toBeTruthy();
    expect(reminderDateError(
      { kind: "calendar", scheduledDate: "2026-09-12" },
      "2026-09-12",
    )).toBeNull();
  });

  it("uses a future Play date outside a single-day view and otherwise local today", () => {
    expect(reminderContextDate({
      scheduledDate: "2026-09-12",
      todayDate: "2026-09-07",
    })).toBe("2026-09-12");
    expect(reminderContextDate({
      scheduledDate: "2026-09-06",
      todayDate: "2026-09-07",
    })).toBe("2026-09-07");
  });

  it("places multiple due Reminders deterministically before existing Headlines", () => {
    expect(promotionOrderUpdates({
      dueReminders: [
        { id: "due-later", order: 300 },
        { id: "due-first", order: 100 },
      ],
      existingHeadlines: [
        { id: "headline-1", order: 1000 },
        { id: "headline-2", order: 2000 },
      ],
      step: 1000,
    })).toEqual([
      { id: "due-first", order: 333 },
      { id: "due-later", order: 666 },
    ]);
  });

  it("rebalances without duplicate priorities when the top has no available gap", () => {
    expect(promotionOrderUpdates({
      dueReminders: [{ id: "due", order: 50 }],
      existingHeadlines: [{ id: "headline", order: 0 }],
      step: 1000,
    })).toEqual([
      { id: "due", order: 1000 },
      { id: "headline", order: 2000 },
    ]);
  });
});
