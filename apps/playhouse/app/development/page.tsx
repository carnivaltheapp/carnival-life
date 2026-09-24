import type { Metadata } from "next";

import { loadPublicDevelopmentRoadmap } from "../../lib/development/roadmap.server";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import { DevelopmentConsole } from "./development-console";
import { loadDevelopmentPageState } from "./development-page-state.server";
import { PublicDevelopmentRoadmap } from "./public-roadmap";

export const metadata: Metadata = {
  description: "Carnival Life features, priorities, dependencies, and development sequence.",
  robots: { follow: false, index: false },
  title: "Carnival Development",
};

export const dynamic = "force-dynamic";

export default async function DevelopmentPage() {
  if (isSupabaseConfigured()) {
    const state = await loadDevelopmentPageState();
    if (state.kind === "signed-in") {
      return (
        <DevelopmentConsole
          dataError={state.dataError}
          initialComponents={state.components}
          identity={{ displayName: state.displayName, email: state.email }}
          initialFeatures={state.features}
        />
      );
    }
  }
  const roadmap = await loadPublicDevelopmentRoadmap();
  return <PublicDevelopmentRoadmap features={roadmap?.features ?? []} />;
}
