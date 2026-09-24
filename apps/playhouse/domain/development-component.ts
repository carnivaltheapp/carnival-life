import {
  DEVELOPMENT_ICON_IDS,
  isDevelopmentFeatureId,
  type DevelopmentIconId,
} from "./development-feature";

export type DevelopmentComponentInput = {
  hidden: boolean;
  icon: DevelopmentIconId;
  name: string;
};

export function parseDevelopmentComponentInput(
  value: unknown,
): { input: DevelopmentComponentInput; ok: true } | { error: string; ok: false } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Component details are required.", ok: false };
  }
  const candidate = value as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim().slice(0, 80) : "";
  if (!name) return { error: "Component name is required.", ok: false };
  if (typeof candidate.icon !== "string" || !DEVELOPMENT_ICON_IDS.includes(
    candidate.icon as DevelopmentIconId,
  )) {
    return { error: "Choose a valid component icon.", ok: false };
  }
  if (typeof candidate.hidden !== "boolean") {
    return { error: "Component visibility is invalid.", ok: false };
  }
  return { input: { hidden: candidate.hidden, icon: candidate.icon as DevelopmentIconId, name }, ok: true };
}

export function parseDevelopmentComponentOrder(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const componentIds = (value as { componentIds?: unknown }).componentIds;
  if (!Array.isArray(componentIds) || componentIds.length > 100 || componentIds.some(
    (id) => typeof id !== "string" || !isDevelopmentFeatureId(id),
  ) || new Set(componentIds).size !== componentIds.length) return null;
  return componentIds as string[];
}
