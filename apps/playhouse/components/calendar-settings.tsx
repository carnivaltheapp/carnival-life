"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import {
  discoverGoogleCalendars,
  setGoogleCalendarMode,
  syncGoogleAppointments,
} from "../app/calendars/actions";
import {
  INITIAL_CALENDAR_SETTINGS_STATE,
  calendarBlockPresentation,
  getCarnivalCalendarSemantic,
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

function SyncAppointments({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    syncGoogleAppointments,
    INITIAL_CALENDAR_SETTINGS_STATE,
  );

  useEffect(() => {
    if (state.status !== "idle") router.refresh();
  }, [router, state.status]);

  return (
    <form action={action} className="calendarDiscoverForm">
      <input name="googleAccountId" type="hidden" value={accountId} />
      <button disabled={pending} type="submit">
        {pending ? "Syncing…" : "Sync Calendar Inputs"}
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

  const presentation = calendarBlockPresentation(calendar.semanticRole, calendar.mode);

  return (
    <form action={action} className="calendarModeControl">
      <input name="calendarId" type="hidden" value={calendar.id} />
      <input
        name="mode"
        type="hidden"
        value={presentation.checked ? "ignored" : "blocking"}
      />
      <input
        aria-label={`Block ${calendar.summary}`}
        checked={presentation.checked}
        disabled={pending}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        title={presentation.title}
        type="checkbox"
      />
      {state.status === "error" ? <small role="alert">{state.message}</small> : null}
    </form>
  );
}

function CalendarBlockControl({ calendar }: { calendar: CalendarSettingsCalendar }) {
  const semantic = getCarnivalCalendarSemantic(calendar.semanticRole);

  if (!semantic) return <CalendarModeControl calendar={calendar} />;

  const presentation = calendarBlockPresentation(calendar.semanticRole, calendar.mode);

  return (
    <input
      aria-label={`Block ${calendar.summary}`}
      checked={presentation.checked}
      disabled
      readOnly
      title={presentation.title}
      type="checkbox"
    />
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
            <div className="calendarAccountActions">
              <DiscoverCalendars accountId={account.id} />
              {account.calendars.some((calendar) =>
                calendar.semanticRole === "appointment" || calendar.semanticRole === "event"
              ) ? (
                <SyncAppointments accountId={account.id} />
              ) : null}
            </div>
          </div>
          {account.calendars.length ? (
            <div className="calendarTableViewport">
              <table className="calendarTable">
                <thead>
                  <tr>
                    <th>Block</th>
                    <th>Calendar</th>
                    <th>Type</th>
                    <th>Behavior</th>
                  </tr>
                </thead>
                <tbody>
                  {account.calendars.map((calendar) => {
                    const semantic = getCarnivalCalendarSemantic(calendar.semanticRole);
                    const presentation = calendarBlockPresentation(
                      calendar.semanticRole,
                      calendar.mode,
                    );
                    return (
                      <tr key={calendar.id}>
                        <td className="calendarBlockCell" data-label="Block">
                          <CalendarBlockControl calendar={calendar} />
                        </td>
                        <td className="calendarNameCell" data-label="Calendar" title={calendar.summary}>
                          <strong>{calendar.summary}</strong>
                          {calendar.isPrimary ? <small>Primary</small> : null}
                        </td>
                        <td data-label="Type">
                          {semantic ? <span className="calendarTypeBadge">{semantic.label}</span> : "—"}
                        </td>
                        <td data-label="Behavior">{presentation.behavior}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No calendars discovered yet.</p>
          )}
        </div>
      ))}
    </section>
  );
}
