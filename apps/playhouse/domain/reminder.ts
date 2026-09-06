import type { PlayPlacement } from "./play";
import { orderUpdatesForInsertion, type OrderedPlay } from "./play-order";

export const REMINDER_DATE_ERROR = "Choose a date after today.";

function isIsoCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function reminderDateError(
  placement: PlayPlacement | null,
  todayDate: string,
) {
  if (
    !placement ||
    placement.kind !== "calendar" ||
    !isIsoCalendarDate(placement.scheduledDate) ||
    placement.scheduledDate <= todayDate ||
    placement.scheduledDate >= "2200-01-01"
  ) {
    return REMINDER_DATE_ERROR;
  }
  return null;
}

export function promotionOrderUpdates({
  dueReminders,
  existingHeadlines,
  lowerBound = 0,
  step,
}: {
  dueReminders: OrderedPlay[];
  existingHeadlines: OrderedPlay[];
  lowerBound?: number;
  step: number;
}) {
  const orderedDue = [...dueReminders].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
  return orderUpdatesForInsertion({
    beforePlayId: existingHeadlines[0]?.id ?? null,
    destination: existingHeadlines,
    lowerBound,
    movingPlayIds: orderedDue.map((play) => play.id),
    step,
  });
}
