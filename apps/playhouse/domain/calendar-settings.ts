export type CalendarAvailabilityMode = "blocking" | "ignored";

export type CarnivalCalendarSemanticRole =
  | "appointment"
  | "event"
  | "place"
  | "play"
  | "reminder"
  | "done"
  | "none";

export type CarnivalCalendarSemantic = {
  blockingScope: "event_time" | "whole_day" | "none";
  description: string;
  direction: "google_to_carnival" | "carnival_to_google";
  label: string;
};

const SEMANTIC_ROLE_BY_NAME: Readonly<Record<string, CarnivalCalendarSemanticRole>> = {
  at_appointments: "appointment",
  at_done: "done",
  at_events: "event",
  at_places: "place",
  at_plays: "play",
  at_reminders: "reminder",
};

export const CARNIVAL_CALENDAR_SEMANTICS: Readonly<
  Record<Exclude<CarnivalCalendarSemanticRole, "none">, CarnivalCalendarSemantic>
> = {
  appointment: {
    blockingScope: "event_time",
    description: "Google → Carnival · blocks event time",
    direction: "google_to_carnival",
    label: "Appointments",
  },
  done: {
    blockingScope: "none",
    description: "Carnival → Google",
    direction: "carnival_to_google",
    label: "Done",
  },
  event: {
    blockingScope: "event_time",
    description: "Google → Carnival · blocks event time",
    direction: "google_to_carnival",
    label: "Events",
  },
  place: {
    blockingScope: "whole_day",
    description: "Google → Carnival · blocks whole day",
    direction: "google_to_carnival",
    label: "Places",
  },
  play: {
    blockingScope: "none",
    description: "Carnival → Google",
    direction: "carnival_to_google",
    label: "Plays",
  },
  reminder: {
    blockingScope: "none",
    description: "Carnival → Google",
    direction: "carnival_to_google",
    label: "Reminders",
  },
};

export function detectCarnivalCalendarSemanticRole(
  summary: string,
): CarnivalCalendarSemanticRole {
  return SEMANTIC_ROLE_BY_NAME[summary.trim().toLowerCase()] ?? "none";
}

export function getCarnivalCalendarSemantic(
  role: CarnivalCalendarSemanticRole,
) {
  return role === "none" ? null : CARNIVAL_CALENDAR_SEMANTICS[role];
}

export function calendarBlockPresentation(
  role: CarnivalCalendarSemanticRole,
  mode: CalendarAvailabilityMode,
) {
  const semantic = getCarnivalCalendarSemantic(role);

  if (!semantic) {
    const checked = mode === "blocking";
    return {
      behavior: checked ? "Blocks event time" : "Ignored",
      checked,
      disabled: false,
      title: checked
        ? "This calendar blocks event time."
        : "This calendar does not block Roller availability.",
    };
  }

  const checked = semantic.blockingScope !== "none";
  const title =
    semantic.blockingScope === "event_time"
      ? `${semantic.label} always block their event time.`
      : semantic.blockingScope === "whole_day"
        ? `${semantic.label} always block the whole day.`
        : `Carnival ${semantic.label} are managed by Carnival and are not external blocking calendars.`;

  return {
    behavior:
      semantic.blockingScope === "event_time"
        ? "Google → Carnival · event time"
        : semantic.blockingScope === "whole_day"
          ? "Google → Carnival · whole day"
          : "Carnival → Google",
    checked,
    disabled: true,
    title,
  };
}

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
  semanticRole: CarnivalCalendarSemanticRole;
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
  existingSemanticRoles,
  googleAccountId,
  ownerUserId,
}: {
  calendars: DiscoveredGoogleCalendar[];
  existingModes: ReadonlyMap<string, CalendarAvailabilityMode>;
  existingSemanticRoles: ReadonlyMap<string, CarnivalCalendarSemanticRole>;
  googleAccountId: string;
  ownerUserId: string;
}) {
  return calendars.map((calendar) => {
    const existingRole = existingSemanticRoles.get(calendar.providerCalendarId);

    return {
      access_role: calendar.accessRole,
      google_account_id: googleAccountId,
      is_blocking:
        (existingModes.get(calendar.providerCalendarId) ??
          (calendar.isPrimary ? "blocking" : "ignored")) === "blocking",
      is_primary: calendar.isPrimary,
      owner_user_id: ownerUserId,
      provider_calendar_id: calendar.providerCalendarId,
      semantic_role:
        existingRole && existingRole !== "none"
          ? existingRole
          : detectCarnivalCalendarSemanticRole(calendar.summary),
      summary: calendar.summary,
      time_zone: calendar.timeZone,
    };
  });
}
