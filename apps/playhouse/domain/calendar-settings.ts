export type CalendarAvailabilityMode = "blocking" | "ignored";

export type DiscoveredGoogleCalendar = {
  accessRole: string | null;
  isPrimary: boolean;
  providerCalendarId: string;
  summary: string;
  timeZone: string | null;
};

export type CalendarSettingsCalendar = DiscoveredGoogleCalendar & {
  id: string;
  mode: CalendarAvailabilityMode;
};

export type CalendarSettingsAccount = {
  calendars: CalendarSettingsCalendar[];
  connectionStatus: "connected" | "disconnected" | "error";
  displayName: string | null;
  email: string | null;
  id: string;
};

export type CalendarSettingsState = {
  message?: string;
  status: "idle" | "success" | "error";
};

export const INITIAL_CALENDAR_SETTINGS_STATE: CalendarSettingsState = {
  status: "idle",
};

export function calendarDiscoveryRows({
  calendars,
  existingModes,
  googleAccountId,
  ownerUserId,
}: {
  calendars: DiscoveredGoogleCalendar[];
  existingModes: ReadonlyMap<string, CalendarAvailabilityMode>;
  googleAccountId: string;
  ownerUserId: string;
}) {
  return calendars.map((calendar) => ({
    access_role: calendar.accessRole,
    google_account_id: googleAccountId,
    is_blocking:
      (existingModes.get(calendar.providerCalendarId) ??
        (calendar.isPrimary ? "blocking" : "ignored")) === "blocking",
    is_primary: calendar.isPrimary,
    owner_user_id: ownerUserId,
    provider_calendar_id: calendar.providerCalendarId,
    summary: calendar.summary,
    time_zone: calendar.timeZone,
  }));
}
