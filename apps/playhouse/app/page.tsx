import { PlayhouseShell } from "../components/playhouse-shell";
import { SignedOutScreen } from "../components/signed-out-screen";
import { loadGoogleCalendarSettings } from "../lib/google/calendar-settings";
import { loadPlayhouseData } from "../lib/playhouse/data";
import {
  BROWSER_TIME_ZONE_COOKIE,
  resolveTimeZone,
} from "../lib/playhouse/time-zone";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { createClient } from "../lib/supabase/server";
import { cookies } from "next/headers";

type SearchValue = string | string[] | undefined;

function firstValue(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

function claimString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function userMetadata(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const params = await searchParams;
  const authError = Boolean(firstValue(params.authError));

  if (!isSupabaseConfigured()) {
    return <SignedOutScreen authError={authError} configurationMissing />;
  }

  let pageState:
    | { authFailed: boolean; kind: "signed-out" }
    | {
        kind: "signed-in";
        baskets: Awaited<ReturnType<typeof loadPlayhouseData>>["baskets"];
        calendarAccounts: Awaited<ReturnType<typeof loadGoogleCalendarSettings>>["accounts"];
        calendarSettingsError: boolean;
        dataError: boolean;
        displayName: string;
        email: string | null;
        nextPlayOptions: Awaited<ReturnType<typeof loadPlayhouseData>>["nextPlayOptions"];
        plays: Awaited<ReturnType<typeof loadPlayhouseData>>["plays"];
        selectedView: Awaited<ReturnType<typeof loadPlayhouseData>>["selectedView"];
        supportsWorkflows: boolean;
        searchQuery: string;
        todayDate: string;
      };

  try {
    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;
    const subject = claimString(claims?.sub);

    if (claimsError || !claims || !subject) {
      pageState = { authFailed: Boolean(claimsError), kind: "signed-out" };
    } else {
      const metadata = userMetadata(claims.user_metadata);
      const email = claimString(claims.email);
      const fallbackName =
        claimString(metadata.full_name) ??
        claimString(metadata.name) ??
        email ??
        "Carnival Player";

      const [profileResult, cookieStore, calendarSettings] = await Promise.all([
        supabase.from("users").select("display_name, timezone").maybeSingle(),
        cookies(),
        loadGoogleCalendarSettings(supabase, subject),
      ]);
      const { data: profile, error: profileError } = profileResult;
      const timeZone = resolveTimeZone(
        cookieStore.get(BROWSER_TIME_ZONE_COOKIE)?.value,
        profile?.timezone,
      );
      const playhouseData = await loadPlayhouseData({
        basketSlug: firstValue(params.basket),
        date: firstValue(params.date),
        ownerUserId: subject,
        supabase,
        timeZone,
        view: firstValue(params.view),
        searchQuery: firstValue(params.q)?.trim().slice(0, 200),
      });

      pageState = {
        baskets: playhouseData.baskets,
        calendarAccounts: calendarSettings.accounts,
        calendarSettingsError: calendarSettings.error,
        dataError: Boolean(profileError) || playhouseData.error,
        displayName: profile?.display_name || fallbackName,
        email,
        kind: "signed-in",
        nextPlayOptions: playhouseData.nextPlayOptions,
        plays: playhouseData.plays,
        selectedView: playhouseData.selectedView,
        supportsWorkflows: playhouseData.supportsWorkflows,
        searchQuery: playhouseData.searchQuery,
        todayDate: playhouseData.todayDate,
      };
    }
  } catch {
    pageState = { authFailed: true, kind: "signed-out" };
  }

  if (pageState.kind === "signed-out") {
    return (
      <SignedOutScreen
        authError={authError || pageState.authFailed}
        configurationMissing={false}
      />
    );
  }

  return (
    <PlayhouseShell
      baskets={pageState.baskets}
      calendarAccounts={pageState.calendarAccounts}
      calendarSettingsError={pageState.calendarSettingsError}
      dataError={pageState.dataError}
      identity={{
        displayName: pageState.displayName,
        email: pageState.email,
      }}
      nextPlayOptions={pageState.nextPlayOptions}
      plays={pageState.plays}
      selectedView={pageState.selectedView}
      searchQuery={pageState.searchQuery}
      supportsWorkflows={pageState.supportsWorkflows}
      todayDate={pageState.todayDate}
    />
  );
}
