export const CALENDAR_VIEWS = [
  { key: "today", label: "Today", marker: "●" },
  { key: "tomorrow", label: "Tomorrow", marker: "○" },
  { key: "date", label: "Go to Date", marker: "▣" },
  { key: "week", label: "Next 7 days", marker: "•••" },
  { key: "all", label: "All Plays", marker: "∞" },
] as const;

export function addCalendarDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function calendarDateHref(date: string, todayDate: string) {
  if (date === todayDate) return "/?view=today";
  if (date === addCalendarDays(todayDate, 1)) return "/?view=tomorrow";
  return `/?date=${date}`;
}

export function friendlyCalendarDate(isoDate: string, abbreviated = false) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: abbreviated ? "short" : "long",
    timeZone: "UTC",
    weekday: abbreviated ? "short" : "long",
  }).format(new Date(`${isoDate}T00:00:00.000Z`));
}
