import {
  isDevelopmentFeatureId,
  sortDevelopmentFeatures,
  type DevelopmentFeature,
} from "./development-feature";

export function parseDevelopmentFeatureOrder(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const featureIds = (value as { featureIds?: unknown }).featureIds;
  if (!Array.isArray(featureIds) || featureIds.length > 10_000 || featureIds.some(
    (id) => typeof id !== "string" || !isDevelopmentFeatureId(id),
  ) || new Set(featureIds).size !== featureIds.length) return null;
  return featureIds as string[];
}

export function reorderVisibleDevelopmentFeatures(
  features: DevelopmentFeature[],
  visibleFeatureIds: string[],
) {
  const globalOrder = sortDevelopmentFeatures(features);
  const visibleSet = new Set(visibleFeatureIds);
  if (
    visibleSet.size !== visibleFeatureIds.length ||
    globalOrder.filter((feature) => visibleSet.has(feature.id)).length !== visibleFeatureIds.length
  ) return null;
  const byId = new Map(globalOrder.map((feature) => [feature.id, feature]));
  if (visibleFeatureIds.some((id) => !byId.has(id))) return null;
  let visibleIndex = 0;
  return globalOrder.map((feature) => visibleSet.has(feature.id)
    ? byId.get(visibleFeatureIds[visibleIndex++])!
    : feature).map((feature, index) => ({ ...feature, sequence: index + 1 }));
}

export function moveDevelopmentFeature(
  visibleFeatures: DevelopmentFeature[],
  draggedFeatureId: string,
  targetFeatureId: string,
  edge: "before" | "after",
) {
  if (draggedFeatureId === targetFeatureId) return visibleFeatures.map((feature) => feature.id);
  const ids = visibleFeatures.map((feature) => feature.id);
  const from = ids.indexOf(draggedFeatureId);
  const target = ids.indexOf(targetFeatureId);
  if (from < 0 || target < 0) return null;
  ids.splice(from, 1);
  const adjustedTarget = ids.indexOf(targetFeatureId);
  ids.splice(adjustedTarget + (edge === "after" ? 1 : 0), 0, draggedFeatureId);
  return ids;
}
