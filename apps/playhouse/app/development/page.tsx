import type { Metadata } from "next";

import { SignedOutScreen } from "../../components/signed-out-screen";
import type { DevelopmentFeature } from "../../domain/development-feature";
import { MongoDevelopmentFeatureRepository } from "../../lib/development/repository";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import { createClient } from "../../lib/supabase/server";
import { DevelopmentConsole } from "./development-console";

export const metadata: Metadata = {
  description: "Carnival Life features, priorities, dependencies, and development sequence.",
  title: "Carnival Development",
};

export const dynamic = "force-dynamic";

type DevelopmentPageState =
  | { authError: boolean; kind: "signed-out" }
  | {
      dataError: boolean;
      displayName: string;
      email: string | null;
      features: DevelopmentFeature[];
      kind: "signed-in";
    };

function claimString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function recordValue(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

async function loadDevelopmentPageState(): Promise<DevelopmentPageState> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    const ownerUserId = claimString(claims?.sub);
    if (error || !claims || !ownerUserId) {
      return { authError: Boolean(error), kind: "signed-out" };
    }

    const metadata = recordValue(claims.user_metadata);
    const email = claimString(claims.email);
    const displayName = claimString(metadata.full_name) ?? claimString(metadata.name) ??
      email ?? "Carnival Builder";
    let features: DevelopmentFeature[] = [];
    let dataError = false;
    try {
      const repository = new MongoDevelopmentFeatureRepository();
      await repository.ensureDemoSeed(ownerUserId);
      features = await repository.list(ownerUserId);
    } catch (repositoryError) {
      dataError = true;
      console.error("CARNIVAL_DEVELOPMENT PAGE_LOAD_FAILED", {
        reason: repositoryError instanceof Error ? repositoryError.name : "unknown_error",
      });
    }

    return { dataError, displayName, email, features, kind: "signed-in" };
  } catch {
    return { authError: true, kind: "signed-out" };
  }
}

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
      identity={{ displayName: state.displayName, email: state.email }}
      initialFeatures={state.features}
    />
  );
}
