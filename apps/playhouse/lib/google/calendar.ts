import type { DiscoveredGoogleCalendar } from "../../domain/calendar-settings";

const GOOGLE_CALENDAR_API_ORIGIN = "https://www.googleapis.com";

export class GoogleCalendarApiError extends Error {
  constructor(public readonly status: number) {
    super("Google Calendar discovery failed.");
    this.name = "GoogleCalendarApiError";
  }
}

type GoogleCalendarListEntry = {
  accessRole?: unknown;
  id?: unknown;
  primary?: unknown;
  summary?: unknown;
  timeZone?: unknown;
};

type GoogleCalendarListResponse = {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mapGoogleCalendar(
  calendar: GoogleCalendarListEntry,
): DiscoveredGoogleCalendar | null {
  const providerCalendarId = text(calendar.id);
  if (!providerCalendarId) return null;

  return {
    accessRole: text(calendar.accessRole),
    isPrimary: calendar.primary === true,
    providerCalendarId,
    summary: text(calendar.summary) ?? providerCalendarId,
    timeZone: text(calendar.timeZone),
  };
}

export async function listGoogleCalendars(
  accessToken: string,
  request: typeof fetch = fetch,
) {
  const calendars = new Map<string, DiscoveredGoogleCalendar>();
  const seenPageTokens = new Set<string>();
  let pageToken: string | null = null;

  do {
    const url = new URL("/calendar/v3/users/me/calendarList", GOOGLE_CALENDAR_API_ORIGIN);
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("showHidden", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await request(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new GoogleCalendarApiError(response.status);

    const page = (await response.json()) as GoogleCalendarListResponse;
    for (const entry of page.items ?? []) {
      const calendar = mapGoogleCalendar(entry);
      if (calendar) calendars.set(calendar.providerCalendarId, calendar);
    }

    pageToken = text(page.nextPageToken);
    if (pageToken && seenPageTokens.has(pageToken)) {
      throw new Error("Google Calendar discovery returned invalid pagination.");
    }
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);

  return [...calendars.values()];
}
