import { PlayhouseShell } from "../components/playhouse-shell";
import { SignedOutScreen } from "../components/signed-out-screen";
import { loadPlayhouseData } from "../lib/playhouse/data";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { createClient } from "../lib/supabase/server";

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
        contacts: Awaited<ReturnType<typeof loadPlayhouseData>>["contacts"];
        dataError: boolean;
        displayName: string;
        email: string | null;
        nextPlayOptions: Awaited<ReturnType<typeof loadPlayhouseData>>["nextPlayOptions"];
        plays: Awaited<ReturnType<typeof loadPlayhouseData>>["plays"];
        selectedView: Awaited<ReturnType<typeof loadPlayhouseData>>["selectedView"];
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

      const { data: profile, error: profileError } = await supabase
        .from("users")
        .select("display_name, timezone")
        .maybeSingle();
      const timeZone = profile?.timezone || "UTC";
      const playhouseData = await loadPlayhouseData({
        basketSlug: firstValue(params.basket),
        date: firstValue(params.date),
        supabase,
        timeZone,
        view: firstValue(params.view),
      });

      pageState = {
        baskets: playhouseData.baskets,
        contacts: playhouseData.contacts,
        dataError: Boolean(profileError) || playhouseData.error,
        displayName: profile?.display_name || fallbackName,
        email,
        kind: "signed-in",
        nextPlayOptions: playhouseData.nextPlayOptions,
        plays: playhouseData.plays,
        selectedView: playhouseData.selectedView,
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
      contacts={pageState.contacts}
      dataError={pageState.dataError}
      identity={{
        displayName: pageState.displayName,
        email: pageState.email,
      }}
      nextPlayOptions={pageState.nextPlayOptions}
      plays={pageState.plays}
      selectedView={pageState.selectedView}
    />
  );
}
