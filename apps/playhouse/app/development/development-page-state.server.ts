import "server-only";

import type {
  DevelopmentComponentRecord,
  DevelopmentFeature,
} from "../../domain/development-feature";
import { MongoDevelopmentFeatureRepository } from "../../lib/development/repository";
import { createClient } from "../../lib/supabase/server";

export type DevelopmentPageState =
  | { authError: boolean; kind: "signed-out" }
  | {
      dataError: boolean;
      components: DevelopmentComponentRecord[];
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

export async function loadDevelopmentPageState(): Promise<DevelopmentPageState> {
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
    let components: DevelopmentComponentRecord[] = [];
    let features: DevelopmentFeature[] = [];
    let dataError = false;
    try {
      const repository = new MongoDevelopmentFeatureRepository();
      await repository.ensureDevelopmentData(ownerUserId);
      [components, features] = await Promise.all([
        repository.listComponents(ownerUserId),
        repository.list(ownerUserId),
      ]);
    } catch (repositoryError) {
      dataError = true;
      console.error("CARNIVAL_DEVELOPMENT PAGE_LOAD_FAILED", {
        reason: repositoryError instanceof Error ? repositoryError.name : "unknown_error",
      });
    }

    return { components, dataError, displayName, email, features, kind: "signed-in" };
  } catch {
    return { authError: true, kind: "signed-out" };
  }
}
