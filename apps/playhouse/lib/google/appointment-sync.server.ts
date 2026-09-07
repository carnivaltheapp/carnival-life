import "server-only";

import {
  appointmentSyncWindow,
  listGoogleCalendarEvents,
  mapGoogleAppointmentEvent,
} from "./appointment-events";
import { getGoogleAccessToken } from "./token-broker.server";
import { getLegacyTaskCollection } from "../playhouse/mongo-client";
import { synchronizeMongoAppointments } from "../playhouse/mongo-appointment-sync";

export async function syncAppointmentCalendarsForAccount({
  calendars,
  googleAccountId,
  ownerUserId,
}: {
  calendars: Array<{ providerCalendarId: string; timeZone: string }>;
  googleAccountId: string;
  ownerUserId: string;
}) {
  const accessToken = await getGoogleAccessToken({ googleAccountId, ownerUserId });
  const collection = await getLegacyTaskCollection();
  const totals = { failed: 0, imported: 0, inactivated: 0, unchanged: 0, updated: 0 };

  for (const calendar of calendars) {
    const window = appointmentSyncWindow({ timeZone: calendar.timeZone });
    const googleEvents = await listGoogleCalendarEvents({
      accessToken,
      calendarId: calendar.providerCalendarId,
      endDateExclusive: window.endDateExclusive,
      startDate: window.startDate,
      timeZone: calendar.timeZone,
    });
    const result = await synchronizeMongoAppointments({
      collection,
      events: googleEvents.map((event) =>
        mapGoogleAppointmentEvent(event, calendar.timeZone)),
      identity: {
        googleAccountId,
        googleCalendarId: calendar.providerCalendarId,
      },
    });
    totals.failed += result.failed.length;
    totals.imported += result.imported;
    totals.inactivated += result.inactivated;
    totals.unchanged += result.unchanged;
    totals.updated += result.updated;
  }

  return totals;
}
