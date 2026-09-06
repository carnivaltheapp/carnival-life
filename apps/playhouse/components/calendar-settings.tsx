"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import {
  discoverGoogleCalendars,
  setGoogleCalendarMode,
} from "../app/calendars/actions";
import {
  INITIAL_CALENDAR_SETTINGS_STATE,
  type CalendarAvailabilityMode,
  type CalendarSettingsAccount,
  type CalendarSettingsCalendar,
} from "../domain/calendar-settings";

function DiscoverCalendars({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    discoverGoogleCalendars,
    INITIAL_CALENDAR_SETTINGS_STATE,
  );

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form action={action} className="calendarDiscoverForm">
      <input name="googleAccountId" type="hidden" value={accountId} />
      <button disabled={pending} type="submit">
        {pending ? "Refreshing…" : "Refresh"}
      </button>
      {state.message ? (
        <small data-status={state.status} role={state.status === "error" ? "alert" : undefined}>
          {state.message}
        </small>
      ) : null}
    </form>
  );
}

function CalendarModeControl({
  calendar,
}: {
  calendar: CalendarSettingsCalendar;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    setGoogleCalendarMode,
    INITIAL_CALENDAR_SETTINGS_STATE,
  );

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form action={action} className="calendarModeControl">
      <input name="calendarId" type="hidden" value={calendar.id} />
      {(["blocking", "ignored"] as const).map((mode: CalendarAvailabilityMode) => (
        <button
          aria-pressed={calendar.mode === mode}
          disabled={pending}
          key={mode}
          name="mode"
          type="submit"
          value={mode}
        >
          {mode === "blocking" ? "Blocking" : "Ignored"}
        </button>
      ))}
      {state.status === "error" ? <small role="alert">{state.message}</small> : null}
    </form>
  );
}

export function CalendarSettings({
  accounts,
  error,
}: {
  accounts: CalendarSettingsAccount[];
  error: boolean;
}) {
  return (
    <section className="calendarSettings" aria-labelledby="calendar-settings-heading">
      <h2 id="calendar-settings-heading">Calendars</h2>
      {error ? <p role="alert">Calendar settings could not be loaded.</p> : null}
      {!error && accounts.length === 0 ? (
        <p>Reconnect Google to discover calendars.</p>
      ) : null}
      {accounts.map((account) => (
        <div className="calendarAccount" key={account.id}>
          <div className="calendarAccountHeader">
            <strong>{account.displayName ?? account.email ?? "Google account"}</strong>
            {account.displayName && account.email ? <small>{account.email}</small> : null}
            <DiscoverCalendars accountId={account.id} />
          </div>
          {account.calendars.length ? (
            <ul>
              {account.calendars.map((calendar) => (
                <li key={calendar.id}>
                  <span title={calendar.summary}>
                    {calendar.summary}
                    {calendar.isPrimary ? <small>Primary</small> : null}
                  </span>
                  <CalendarModeControl calendar={calendar} />
                </li>
              ))}
            </ul>
          ) : (
            <p>No calendars discovered yet.</p>
          )}
        </div>
      ))}
    </section>
  );
}
