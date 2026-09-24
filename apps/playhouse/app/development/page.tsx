import type { Metadata } from "next";

import { SignedOutScreen } from "../../components/signed-out-screen";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import { DevelopmentConsole } from "./development-console";
import { loadDevelopmentPageState } from "./development-page-state.server";

export const metadata: Metadata = {
  description: "Carnival Life features, priorities, dependencies, and development sequence.",
  title: "Carnival Development",
};

export const dynamic = "force-dynamic";

export default async function DevelopmentPage() {
  if (!isSupabaseConfigured()) {
    return <SignedOutScreen authError={false} configurationMissing />;
  }
  const state = await loadDevelopmentPageState();
  if (state.kind === "signed-out") {
    return <SignedOutScreen authError={state.authError} configurationMissing={false} />;
  }
  return (
    <DevelopmentConsole
      dataError={state.dataError}
      initialComponents={state.components}
      identity={{ displayName: state.displayName, email: state.email }}
      initialFeatures={state.features}
    />
  );
}
