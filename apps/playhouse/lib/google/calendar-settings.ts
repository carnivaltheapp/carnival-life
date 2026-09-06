import type { SupabaseClient } from "@supabase/supabase-js";

import type { CalendarSettingsAccount } from "../../domain/calendar-settings";
import type { Database } from "../supabase/database.types";

export async function loadGoogleCalendarSettings(
  supabase: SupabaseClient<Database>,
  ownerUserId: string,
): Promise<{ accounts: CalendarSettingsAccount[]; error: boolean }> {
  const [accountResult, calendarResult] = await Promise.all([
    supabase
      .from("google_accounts")
      .select("id, email, display_name, connection_status")
      .eq("owner_user_id", ownerUserId)
      .order("created_at", { ascending: true }),
    supabase
      .from("google_calendars")
      .select(
        "id, google_account_id, provider_calendar_id, summary, is_primary, access_role, time_zone, is_blocking",
      )
      .eq("owner_user_id", ownerUserId)
      .order("is_primary", { ascending: false })
      .order("summary", { ascending: true }),
  ]);
  const calendarsByAccount = new Map<string, CalendarSettingsAccount["calendars"]>();

  if (accountResult.error) {
    console.error("[PlayHouse Calendar] settings load failure", {
      code: accountResult.error.code,
      stage: "connected_account_read",
    });
  }
  if (calendarResult.error) {
    console.error("[PlayHouse Calendar] settings load failure", {
      code: calendarResult.error.code,
      stage:
        calendarResult.error.code === "PGRST205" ||
        calendarResult.error.code === "42P01"
          ? "database_schema"
          : calendarResult.error.code === "42501"
            ? "database_rls"
            : "calendar_configuration_read",
    });
  }

  for (const calendar of calendarResult.data ?? []) {
    const calendars = calendarsByAccount.get(calendar.google_account_id) ?? [];
    calendars.push({
      accessRole: calendar.access_role,
      id: calendar.id,
      isPrimary: calendar.is_primary,
      mode: calendar.is_blocking ? "blocking" : "ignored",
      providerCalendarId: calendar.provider_calendar_id,
      summary: calendar.summary,
      timeZone: calendar.time_zone,
    });
    calendarsByAccount.set(calendar.google_account_id, calendars);
  }

  return {
    accounts: (accountResult.data ?? []).map((account) => ({
      calendars: calendarsByAccount.get(account.id) ?? [],
      connectionStatus: account.connection_status,
      displayName: account.display_name,
      email: account.email,
      id: account.id,
    })),
    error: Boolean(accountResult.error || calendarResult.error),
  };
}
