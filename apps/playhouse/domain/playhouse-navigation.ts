export const CALENDAR_VIEWS = [
  { key: "date", label: "Go to Date", marker: "▣" },
  { key: "week", label: "Next 7 Days", marker: "•••" },
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

export function rollingCalendarDates(todayDate: string) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addCalendarDays(todayDate, index);
    const monthDay = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00.000Z`));
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
    }).format(new Date(`${date}T00:00:00.000Z`));
    return {
      date,
      label: index === 0
        ? `Today ${monthDay}`
        : index === 1
          ? `Tomorrow ${monthDay}`
          : `${weekday} ${monthDay}`,
      marker: index === 0 ? "●" : "○",
    };
  });
}

export function isSelectableCalendarDate(date: string, todayDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= todayDate;
}

export function friendlyCalendarDate(isoDate: string, abbreviated = false) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: abbreviated ? "short" : "long",
    timeZone: "UTC",
    weekday: abbreviated ? "short" : "long",
  }).format(new Date(`${isoDate}T00:00:00.000Z`));
}
