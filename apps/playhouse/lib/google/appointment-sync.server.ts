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
  const syncStartedAt = Date.now();
  const accessToken = await getGoogleAccessToken({ googleAccountId, ownerUserId });
  const collection = await getLegacyTaskCollection();
  const totals = {
    failed: 0,
    googleEvents: 0,
    googlePages: 0,
    imported: 0,
    inactivated: 0,
    mongoReads: 0,
    mongoWriteBatches: 0,
    mongoWrites: 0,
    unchanged: 0,
    updated: 0,
  };

  for (const calendar of calendars) {
    const window = appointmentSyncWindow({ timeZone: calendar.timeZone });
    const calendarStartedAt = Date.now();
    console.info("[PlayHouse Appointment Sync] calendar fetch start", {
      endDateExclusive: window.endDateExclusive,
      startDate: window.startDate,
    });
    const googleResult = await listGoogleCalendarEvents({
      accessToken,
      calendarId: calendar.providerCalendarId,
      endDateExclusive: window.endDateExclusive,
      startDate: window.startDate,
      timeZone: calendar.timeZone,
    });
    const result = await synchronizeMongoAppointments({
      collection,
      endDateExclusive: window.endDateExclusive,
      events: googleResult.events.map((event) =>
        mapGoogleAppointmentEvent(event, calendar.timeZone)),
      identity: {
        googleAccountId,
        googleCalendarId: calendar.providerCalendarId,
      },
      startDate: window.startDate,
    });
    totals.failed += result.failed.length;
    totals.googleEvents += googleResult.events.length;
    totals.googlePages += googleResult.pages;
    totals.imported += result.imported;
    totals.inactivated += result.inactivated;
    totals.mongoReads += result.mongoReads;
    totals.mongoWriteBatches += result.mongoWriteBatches;
    totals.mongoWrites += result.mongoWrites;
    totals.unchanged += result.unchanged;
    totals.updated += result.updated;
    console.info("[PlayHouse Appointment Sync] calendar complete", {
      durationMs: Date.now() - calendarStartedAt,
      failed: result.failed.length,
      googleEvents: googleResult.events.length,
      googlePages: googleResult.pages,
      imported: result.imported,
      inactivated: result.inactivated,
      mongoReads: result.mongoReads,
      mongoWriteBatches: result.mongoWriteBatches,
      mongoWrites: result.mongoWrites,
      unchanged: result.unchanged,
      updated: result.updated,
    });
  }

  console.info("[PlayHouse Appointment Sync] account complete", {
    ...totals,
    durationMs: Date.now() - syncStartedAt,
  });
  return totals;
}
