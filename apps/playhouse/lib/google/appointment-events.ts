import { addDays, dateInTimeZone } from "../playhouse/data";

const GOOGLE_CALENDAR_API_ORIGIN = "https://www.googleapis.com";

export type GoogleCalendarEvent = {
  end?: { date?: unknown; dateTime?: unknown; timeZone?: unknown };
  id?: unknown;
  start?: { date?: unknown; dateTime?: unknown; timeZone?: unknown };
  status?: unknown;
  summary?: unknown;
  updated?: unknown;
};

export type GoogleInputCalendarRole = "appointment" | "event" | "place";

export const GOOGLE_INPUT_CALENDAR_ROLES = ["appointment", "event", "place"] as const;

export type MappedGoogleAppointment = {
  allDay: boolean;
  blockedDates?: string[];
  durationMinutes: number;
  end: string;
  eventId: string;
  googleUpdatedAt: string | null;
  scheduledDate: string;
  start: string;
  status: string;
  taskTime: Date | "";
  timeZone: string;
  title: string;
};

type GoogleEventsListResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function calendarDateMilliseconds(value: string) {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

function zonedMidnightIso(date: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let instant = target;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(new Date(instant));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    instant = target - (represented - instant);
  }

  return new Date(instant).toISOString();
}

export function appointmentSyncWindow({
  now = new Date(),
  timeZone,
}: {
  now?: Date;
  timeZone: string;
}) {
  const today = dateInTimeZone(now, timeZone);
  return { endDateExclusive: addDays(today, 91), startDate: today };
}

export function mapGoogleAppointmentEvent(
  event: GoogleCalendarEvent,
  calendarTimeZone: string,
  untitledTitle = "Untitled Appointment",
): MappedGoogleAppointment | null {
  const eventId = text(event.id);
  const status = text(event.status) ?? "confirmed";
  if (!eventId) return null;

  if (status === "cancelled") {
    return {
      allDay: false,
      durationMinutes: 0,
      end: "",
      eventId,
      googleUpdatedAt: text(event.updated),
      scheduledDate: "",
      start: "",
      status,
      taskTime: "",
      timeZone: calendarTimeZone,
      title: text(event.summary) ?? untitledTitle,
    };
  }

  const startDate = text(event.start?.date);
  const endDate = text(event.end?.date);
  if (startDate || endDate) {
    if (!startDate || !endDate) return null;
    const durationMinutes =
      (calendarDateMilliseconds(endDate) - calendarDateMilliseconds(startDate)) / 60_000;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
    return {
      allDay: true,
      durationMinutes,
      end: endDate,
      eventId,
      googleUpdatedAt: text(event.updated),
      scheduledDate: startDate,
      start: startDate,
      status,
      taskTime: "",
      timeZone: text(event.start?.timeZone) ?? calendarTimeZone,
      title: text(event.summary) ?? untitledTitle,
    };
  }

  const startDateTime = text(event.start?.dateTime);
  const endDateTime = text(event.end?.dateTime);
  if (!startDateTime || !endDateTime) return null;
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0
  ) {
    return null;
  }
  const timeZone = text(event.start?.timeZone) ?? calendarTimeZone;
  return {
    allDay: false,
    durationMinutes,
    end: end.toISOString(),
    eventId,
    googleUpdatedAt: text(event.updated),
    scheduledDate: dateInTimeZone(start, timeZone),
    start: start.toISOString(),
    status,
    taskTime: start,
    timeZone,
    title: text(event.summary) ?? untitledTitle,
  };
}

function calendarDates(startDate: string, endDateExclusive: string) {
  const dates: string[] = [];
  for (let date = startDate; date < endDateExclusive; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export function mapGooglePlaceEvent(
  event: GoogleCalendarEvent,
  calendarTimeZone: string,
  window: { endDateExclusive: string; startDate: string },
): MappedGoogleAppointment | null {
  const eventId = text(event.id);
  const status = text(event.status) ?? "confirmed";
  if (!eventId) return null;

  if (status === "cancelled") {
    return {
      allDay: false,
      blockedDates: [],
      durationMinutes: 0,
      end: "",
      eventId,
      googleUpdatedAt: text(event.updated),
      scheduledDate: "",
      start: "",
      status,
      taskTime: "",
      timeZone: calendarTimeZone,
      title: text(event.summary) ?? "Untitled Place",
    };
  }

  const allDayStart = text(event.start?.date);
  const allDayEnd = text(event.end?.date);
  let sourceStart: string;
  let sourceEnd: string;
  let sourceStartDate: string;
  let sourceEndDateExclusive: string;
  let allDay: boolean;

  if (allDayStart || allDayEnd) {
    if (!allDayStart || !allDayEnd || allDayEnd <= allDayStart) return null;
    sourceStart = allDayStart;
    sourceEnd = allDayEnd;
    sourceStartDate = allDayStart;
    sourceEndDateExclusive = allDayEnd;
    allDay = true;
  } else {
    const startDateTime = text(event.start?.dateTime);
    const endDateTime = text(event.end?.dateTime);
    if (!startDateTime || !endDateTime) return null;
    const start = new Date(startDateTime);
    const end = new Date(endDateTime);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start
    ) {
      return null;
    }
    const timeZone = text(event.start?.timeZone) ?? calendarTimeZone;
    sourceStart = start.toISOString();
    sourceEnd = end.toISOString();
    sourceStartDate = dateInTimeZone(start, timeZone);
    sourceEndDateExclusive = addDays(dateInTimeZone(new Date(end.getTime() - 1), timeZone), 1);
    allDay = false;
  }

  const firstBlockedDate = sourceStartDate < window.startDate
    ? window.startDate
    : sourceStartDate;
  const blockedEndExclusive = sourceEndDateExclusive > window.endDateExclusive
    ? window.endDateExclusive
    : sourceEndDateExclusive;
  const blockedDates = calendarDates(firstBlockedDate, blockedEndExclusive);
  if (!blockedDates.length) return null;

  return {
    allDay,
    blockedDates,
    durationMinutes: 0,
    end: sourceEnd,
    eventId,
    googleUpdatedAt: text(event.updated),
    scheduledDate: blockedDates[0],
    start: sourceStart,
    status,
    taskTime: "",
    timeZone: text(event.start?.timeZone) ?? calendarTimeZone,
    title: text(event.summary) ?? "Untitled Place",
  };
}

export class GoogleCalendarEventsApiError extends Error {
  constructor(public readonly status: number) {
    super("Google Calendar events could not be read.");
    this.name = "GoogleCalendarEventsApiError";
  }
}

export async function listGoogleCalendarEvents({
  accessToken,
  calendarId,
  endDateExclusive,
  request = fetch,
  startDate,
  timeZone,
}: {
  accessToken: string;
  calendarId: string;
  endDateExclusive: string;
  request?: typeof fetch;
  startDate: string;
  timeZone: string;
}) {
  const events: GoogleCalendarEvent[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | null = null;
  let pages = 0;

  do {
    const url = new URL(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      GOOGLE_CALENDAR_API_ORIGIN,
    );
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("timeMin", zonedMidnightIso(startDate, timeZone));
    url.searchParams.set("timeMax", zonedMidnightIso(endDateExclusive, timeZone));
    url.searchParams.set("timeZone", timeZone);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await request(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      method: "GET",
    });
    if (!response.ok) throw new GoogleCalendarEventsApiError(response.status);

    const page = (await response.json()) as GoogleEventsListResponse;
    pages += 1;
    events.push(...(page.items ?? []));
    pageToken = text(page.nextPageToken);
    if (pageToken && seenPageTokens.has(pageToken)) {
      throw new Error("Google Calendar events returned invalid pagination.");
    }
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);

  return { events, pages };
}
