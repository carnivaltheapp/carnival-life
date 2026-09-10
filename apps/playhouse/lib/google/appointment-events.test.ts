import { describe, expect, it, vi } from "vitest";

import {
  appointmentSyncWindow,
  listGoogleCalendarEvents,
  mapGoogleAppointmentEvent,
} from "./appointment-events";
import {
  GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  GOOGLE_OAUTH_SCOPES,
} from "./scopes";

describe("Google Appointment events", () => {
  it("requests the read-only events scope", () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain(GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE);
    expect(GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE).toMatch(/calendar\.events\.readonly$/);
  });

  it("maps a timed event without shifting its calendar date", () => {
    expect(mapGoogleAppointmentEvent({
      end: { dateTime: "2026-09-07T01:30:00-07:00" },
      id: "timed-1",
      start: {
        dateTime: "2026-09-07T00:30:00-07:00",
        timeZone: "America/Los_Angeles",
      },
      status: "confirmed",
      summary: "Early appointment",
      updated: "2026-09-06T20:00:00Z",
    }, "America/Los_Angeles")).toMatchObject({
      allDay: false,
      durationMinutes: 60,
      eventId: "timed-1",
      scheduledDate: "2026-09-07",
      status: "confirmed",
      taskTime: new Date("2026-09-07T07:30:00.000Z"),
      title: "Early appointment",
    });
  });

  it("maps Google all-day dates using the exclusive end date", () => {
    expect(mapGoogleAppointmentEvent({
      end: { date: "2026-09-09" },
      id: "all-day-1",
      start: { date: "2026-09-07" },
      summary: "Conference",
    }, "America/Los_Angeles")).toMatchObject({
      allDay: true,
      durationMinutes: 2880,
      end: "2026-09-09",
      scheduledDate: "2026-09-07",
      start: "2026-09-07",
      taskTime: "",
    });
  });

  it("uses the Event fallback title without changing actual-time mapping", () => {
    expect(mapGoogleAppointmentEvent({
      end: { dateTime: "2026-09-07T21:00:00-07:00" },
      id: "event-1",
      start: { dateTime: "2026-09-07T19:00:00-07:00" },
    }, "America/Los_Angeles", "Untitled Event")).toMatchObject({
      durationMinutes: 120,
      end: "2026-09-08T04:00:00.000Z",
      start: "2026-09-08T02:00:00.000Z",
      title: "Untitled Event",
    });
  });

  it("uses a timezone-correct today-through-90-days inclusive window", () => {
    expect(appointmentSyncWindow({
      now: new Date("2026-09-07T06:30:00Z"),
      timeZone: "America/Los_Angeles",
    })).toEqual({ endDateExclusive: "2026-12-06", startDate: "2026-09-06" });
  });

  it("reads events with GET only and correct bounded RFC3339 instants", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "event-1" }] })),
    );
    const result = await listGoogleCalendarEvents({
      accessToken: "server-token",
      calendarId: "appointments@example.test",
      endDateExclusive: "2026-12-06",
      request,
      startDate: "2026-09-06",
      timeZone: "America/Los_Angeles",
    });

    const [requestUrl, init] = request.mock.calls[0];
    const url = requestUrl as URL;
    expect(init?.method).toBe("GET");
    expect(url.pathname).toContain("appointments%40example.test/events");
    expect(url.searchParams.get("timeMin")).toBe("2026-09-06T07:00:00.000Z");
    expect(url.searchParams.get("timeMax")).toBe("2026-12-06T08:00:00.000Z");
    expect(url.searchParams.get("showDeleted")).toBe("true");
    expect(url.searchParams.get("singleEvents")).toBe("true");
    expect(url.searchParams.get("orderBy")).toBe("startTime");
    expect(result).toEqual({ events: [{ id: "event-1" }], pages: 1 });
  });

  it("reads every Google page exactly once", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "instance-1" }],
        nextPageToken: "page-2",
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "instance-2" }],
      })));

    const result = await listGoogleCalendarEvents({
      accessToken: "server-token",
      calendarId: "appointments@example.test",
      endDateExclusive: "2026-12-06",
      request,
      startDate: "2026-09-06",
      timeZone: "America/Los_Angeles",
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect((request.mock.calls[0][0] as URL).searchParams.get("pageToken")).toBeNull();
    expect((request.mock.calls[1][0] as URL).searchParams.get("pageToken")).toBe("page-2");
    expect(result).toEqual({
      events: [{ id: "instance-1" }, { id: "instance-2" }],
      pages: 2,
    });
  });

  it("isolates malformed events in mapping", () => {
    expect(mapGoogleAppointmentEvent({ id: "missing-time" }, "UTC")).toBeNull();
  });
});
