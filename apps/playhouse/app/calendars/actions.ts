"use server";

import { revalidatePath } from "next/cache";

import {
  calendarDiscoveryRows,
  type CalendarAvailabilityMode,
  type CalendarSettingsState,
} from "../../domain/calendar-settings";
import { isUuid } from "../../domain/play-input";
import { discoverCalendarsForAccount } from "../../lib/google/calendar.server";
import { GoogleCalendarApiError } from "../../lib/google/calendar";
import { GoogleAccountReconnectRequiredError } from "../../lib/google/token-broker";
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

function logCalendarFailure(
  stage: string,
  details: { code?: string; status?: number } = {},
) {
  console.error("[PlayHouse Calendar] operation failure", { ...details, stage });
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
  if (accountError || !account) {
    logCalendarFailure(accountError ? "connected_account_read" : "account_ownership", {
      code: accountError?.code,
    });
    return errorState("That Google account is unavailable.");
  }
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
      .select("provider_calendar_id, is_blocking, semantic_role")
      .eq("google_account_id", account.id)
      .eq("owner_user_id", auth.userId);
    if (existingError) {
      logCalendarFailure(
        existingError.code === "PGRST205" || existingError.code === "42P01"
          ? "database_schema"
          : existingError.code === "42501"
            ? "database_rls"
            : "calendar_configuration_read",
        {
          code: existingError.code,
        },
      );
      return errorState("Calendar settings could not be loaded.");
    }

    const rows = calendarDiscoveryRows({
      calendars,
      existingModes: new Map((existing ?? []).map((calendar) => [
        calendar.provider_calendar_id,
        calendar.is_blocking ? "blocking" : "ignored",
      ])),
      existingSemanticRoles: new Map((existing ?? []).map((calendar) => [
        calendar.provider_calendar_id,
        calendar.semantic_role,
      ])),
      googleAccountId: account.id,
      ownerUserId: auth.userId,
    });
    if (rows.length) {
      const { error } = await auth.supabase
        .from("google_calendars")
        .upsert(rows, { onConflict: "google_account_id,provider_calendar_id" });
      if (error) {
        logCalendarFailure("calendar_configuration_persistence", {
          code: error.code,
        });
        return errorState("Calendars could not be saved.");
      }
    }

    const { error: syncStateError } = await auth.supabase
      .from("google_accounts")
      .update({ last_synced_at: new Date().toISOString(), sync_error: null })
      .eq("id", account.id)
      .eq("owner_user_id", auth.userId);
    if (syncStateError) {
      logCalendarFailure("account_sync_state_persistence", {
        code: syncStateError.code,
      });
    }
    revalidatePath("/");
    return {
      message: `${rows.length} ${rows.length === 1 ? "calendar" : "calendars"} discovered.`,
      status: "success",
    };
  } catch (error) {
    if (error instanceof GoogleAccountReconnectRequiredError) {
      logCalendarFailure("google_reconnect_required");
    } else if (error instanceof GoogleCalendarApiError) {
      logCalendarFailure(
        error.status === 401 || error.status === 403
          ? "google_calendar_permission"
          : "google_calendar_api",
        { status: error.status },
      );
    } else {
      logCalendarFailure("google_calendar_discovery");
    }
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
  if (error || !data) {
    logCalendarFailure(error ? "calendar_mode_persistence" : "calendar_ownership", {
      code: error?.code,
    });
    return errorState("That calendar setting could not be saved.");
  }

  revalidatePath("/");
  return { status: "success" };
}
