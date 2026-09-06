"use server";

import { revalidatePath } from "next/cache";

import {
  calendarDiscoveryRows,
  type CalendarAvailabilityMode,
  type CalendarSettingsState,
} from "../../domain/calendar-settings";
import { isUuid } from "../../domain/play-input";
import { discoverCalendarsForAccount } from "../../lib/google/calendar.server";
import { createClient } from "../../lib/supabase/server";

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  return error || !userId ? null : { supabase, userId };
}

function errorState(message: string): CalendarSettingsState {
  return { message, status: "error" };
}

export async function discoverGoogleCalendars(
  _previousState: CalendarSettingsState,
  formData: FormData,
): Promise<CalendarSettingsState> {
  const googleAccountId = formData.get("googleAccountId");
  if (typeof googleAccountId !== "string" || !isUuid(googleAccountId)) {
    return errorState("That Google account could not be identified.");
  }

  const auth = await authenticatedClient();
  if (!auth) return errorState("Your session expired. Refresh and sign in again.");

  const { data: account, error: accountError } = await auth.supabase
    .from("google_accounts")
    .select("id, connection_status")
    .eq("id", googleAccountId)
    .eq("owner_user_id", auth.userId)
    .maybeSingle();
  if (accountError || !account) return errorState("That Google account is unavailable.");
  if (account.connection_status !== "connected") {
    return errorState("Google authorization must be reconnected before calendars can refresh.");
  }

  try {
    const calendars = await discoverCalendarsForAccount({
      googleAccountId: account.id,
      ownerUserId: auth.userId,
    });
    const { data: existing, error: existingError } = await auth.supabase
      .from("google_calendars")
      .select("provider_calendar_id, is_blocking")
      .eq("google_account_id", account.id)
      .eq("owner_user_id", auth.userId);
    if (existingError) return errorState("Calendar settings could not be loaded.");

    const rows = calendarDiscoveryRows({
      calendars,
      existingModes: new Map((existing ?? []).map((calendar) => [
        calendar.provider_calendar_id,
        calendar.is_blocking ? "blocking" : "ignored",
      ])),
      googleAccountId: account.id,
      ownerUserId: auth.userId,
    });
    if (rows.length) {
      const { error } = await auth.supabase
        .from("google_calendars")
        .upsert(rows, { onConflict: "google_account_id,provider_calendar_id" });
      if (error) return errorState("Calendars could not be saved.");
    }

    await auth.supabase
      .from("google_accounts")
      .update({ last_synced_at: new Date().toISOString(), sync_error: null })
      .eq("id", account.id)
      .eq("owner_user_id", auth.userId);
    revalidatePath("/");
    return {
      message: `${rows.length} ${rows.length === 1 ? "calendar" : "calendars"} discovered.`,
      status: "success",
    };
  } catch {
    return errorState(
      "Google Calendar access is unavailable. Sign out and sign in with Google to grant access.",
    );
  }
}

export async function setGoogleCalendarMode(
  _previousState: CalendarSettingsState,
  formData: FormData,
): Promise<CalendarSettingsState> {
  const calendarId = formData.get("calendarId");
  const mode = formData.get("mode");
  if (
    typeof calendarId !== "string" ||
    !isUuid(calendarId) ||
    (mode !== "blocking" && mode !== "ignored")
  ) {
    return errorState("That calendar setting is invalid.");
  }

  const auth = await authenticatedClient();
  if (!auth) return errorState("Your session expired. Refresh and sign in again.");

  const { data, error } = await auth.supabase
    .from("google_calendars")
    .update({ is_blocking: (mode as CalendarAvailabilityMode) === "blocking" })
    .eq("id", calendarId)
    .eq("owner_user_id", auth.userId)
    .select("id")
    .maybeSingle();
  if (error || !data) return errorState("That calendar setting could not be saved.");

  revalidatePath("/");
  return { status: "success" };
}
