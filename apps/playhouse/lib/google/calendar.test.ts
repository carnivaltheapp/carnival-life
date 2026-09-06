import { describe, expect, it, vi } from "vitest";

import { listGoogleCalendars, mapGoogleCalendar } from "./calendar";
import { GOOGLE_CALENDAR_LIST_READONLY_SCOPE, GOOGLE_OAUTH_SCOPES } from "./scopes";

describe("Google Calendar discovery", () => {
  it("requests only Calendar List read access alongside the existing Contacts scope", () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain(GOOGLE_CALENDAR_LIST_READONLY_SCOPE);
    expect(GOOGLE_CALENDAR_LIST_READONLY_SCOPE).toMatch(/calendar\.calendarlist\.readonly$/);
  });

  it("maps only the minimal Calendar List metadata", () => {
    expect(mapGoogleCalendar({
      accessRole: "owner",
      id: "primary@example.test",
      primary: true,
      summary: "Primary calendar",
      timeZone: "America/Los_Angeles",
    })).toEqual({
      accessRole: "owner",
      isPrimary: true,
      providerCalendarId: "primary@example.test",
      summary: "Primary calendar",
      timeZone: "America/Los_Angeles",
    });
    expect(mapGoogleCalendar({ summary: "Missing identifier" })).toBeNull();
  });

  it("paginates the Calendar List without returning token data", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "one", primary: true, summary: "One" }],
        nextPageToken: "next-page",
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "two", summary: "Two" }],
      })));

    const calendars = await listGoogleCalendars("server-access-token", request);

    expect(calendars.map((calendar) => calendar.providerCalendarId)).toEqual(["one", "two"]);
    expect(JSON.stringify(calendars)).not.toContain("server-access-token");
    const firstUrl = request.mock.calls[0]?.[0] as URL;
    const secondUrl = request.mock.calls[1]?.[0] as URL;
    expect(firstUrl.pathname).toBe("/calendar/v3/users/me/calendarList");
    expect(firstUrl.searchParams.get("showHidden")).toBe("true");
    expect(secondUrl.searchParams.get("pageToken")).toBe("next-page");
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: "Bearer server-access-token",
    });
  });
});
