import { describe, expect, it } from "vitest";

import { promotionOrderUpdates, reminderDateError } from "./reminder";

describe("Reminder deadlines", () => {
  it("requires a real calendar date strictly after browser-local today", () => {
    const today = "2026-09-06";
    expect(reminderDateError(null, today)).toBeTruthy();
    expect(reminderDateError({ kind: "calendar", scheduledDate: "" }, today)).toBeTruthy();
    expect(reminderDateError({ kind: "calendar", scheduledDate: "2026-09-05" }, today)).toBeTruthy();
    expect(reminderDateError({ kind: "calendar", scheduledDate: today }, today)).toBeTruthy();
    expect(reminderDateError({ kind: "calendar", scheduledDate: "2400-01-11" }, today)).toBeTruthy();
    expect(reminderDateError({ kind: "calendar", scheduledDate: "2026-09-07" }, today)).toBeNull();
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
