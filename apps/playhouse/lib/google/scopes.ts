export const GOOGLE_CONTACTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/contacts.readonly";

export const GOOGLE_CALENDAR_LIST_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

export const GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";

export const GOOGLE_GMAIL_MODIFY_SCOPE =
  "https://www.googleapis.com/auth/gmail.modify";

export const GOOGLE_OAUTH_SCOPES = [
  GOOGLE_CONTACTS_READONLY_SCOPE,
  GOOGLE_CALENDAR_LIST_READONLY_SCOPE,
  GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  GOOGLE_GMAIL_MODIFY_SCOPE,
] as const;
