import { timingSafeEqual } from "node:crypto";

import {
  DEVELOPMENT_PRIORITIES,
  DEVELOPMENT_STATUSES,
  normalizeDevelopmentFeatureId,
  sortDevelopmentFeatures,
  type DevelopmentComponentRecord,
  type DevelopmentFeature,
} from "../../domain/development-feature";

export type RoadmapDependency = {
  featureId: string;
  id: string;
  title: string;
};

export type RoadmapFeature = Omit<DevelopmentFeature, "dependencies"> & {
  dependencies: RoadmapDependency[];
};

export type RoadmapResponse = {
  components: DevelopmentComponentRecord[];
  dependencies: Array<{ featureId: string; dependsOnFeatureId: string }>;
  features: RoadmapFeature[];
  globalSequence: string[];
};

export function roadmapReadTokenIsValid(authorization: string | null, configuredToken: string | undefined) {
  const token = configuredToken?.trim() ?? "";
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (token.length < 32 || !match) return false;
  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function buildRoadmap(
  components: DevelopmentComponentRecord[],
  sourceFeatures: DevelopmentFeature[],
): RoadmapResponse {
  const ordered = sortDevelopmentFeatures(sourceFeatures);
  const byId = new Map(ordered.map((feature) => [feature.id, feature]));
  const features = ordered.map((feature): RoadmapFeature => ({
    ...feature,
    dependencies: feature.dependencies.map((dependencyId) => {
      const dependency = byId.get(dependencyId);
      return {
        featureId: dependency?.featureId ?? "",
        id: dependencyId,
        title: dependency?.title ?? "Unknown feature",
      };
    }),
  }));
  return {
    components: [...components].sort((left, right) => left.sortOrder - right.sortOrder),
    dependencies: features.flatMap((feature) => feature.dependencies.map((dependency) => ({
      dependsOnFeatureId: dependency.featureId,
      featureId: feature.featureId,
    }))),
    features,
    globalSequence: features.map((feature) => feature.featureId),
  };
}

export function filterRoadmap(
  roadmap: RoadmapResponse,
  filters: { component?: string | null; priority?: string | null; q?: string | null; status?: string | null },
) {
  const component = filters.component?.trim().toLocaleLowerCase();
  const priority = filters.priority?.trim().toLocaleLowerCase();
  const query = filters.q?.trim().toLocaleLowerCase();
  const status = filters.status?.trim().toLocaleLowerCase();
  const features = roadmap.features.filter((feature) => {
    if (component && ![feature.component, feature.componentId]
      .some((value) => value.toLocaleLowerCase() === component)) return false;
    if (priority && feature.priority.toLocaleLowerCase() !== priority) return false;
    if (status && feature.status.toLocaleLowerCase() !== status) return false;
    if (query && ![
      feature.featureId,
      feature.title,
      feature.description,
      feature.component,
      feature.notes,
    ].some((value) => value.toLocaleLowerCase().includes(query))) return false;
    return true;
  });
  const included = new Set(features.map((feature) => feature.featureId));
  return {
    ...roadmap,
    dependencies: roadmap.dependencies.filter((dependency) => included.has(dependency.featureId)),
    features,
    globalSequence: features.map((feature) => feature.featureId),
  };
}

export function roadmapFeatureByReference(roadmap: RoadmapResponse, reference: string) {
  const featureId = normalizeDevelopmentFeatureId(reference);
  return featureId
    ? roadmap.features.find((feature) => feature.featureId === featureId) ?? null
    : null;
}

export const ROADMAP_SCHEMA = {
  authentication: "Authorization: Bearer <CARNIVAL_ROADMAP_READ_TOKEN>",
  component: {
    fields: ["id", "name", "icon", "sortOrder", "hidden", "createdAt", "updatedAt"],
  },
  dependencySemantics: "Each dependency identifies a prerequisite by internal id and canonical CF-### featureId.",
  endpoints: {
    feature: "GET /api/development/roadmap/CF-###",
    roadmap: "GET /api/development/roadmap",
    schema: "GET /api/development/roadmap/schema",
  },
  feature: {
    fields: [
      "id", "featureId", "title", "description", "componentId", "component", "status",
      "priority", "sequence", "dependencies", "notes", "createdAt", "updatedAt",
    ],
    featureId: "Permanent canonical human reference in CF-### format; never renamed or reused.",
  },
  filters: ["component", "status", "priority", "q"],
  priorityValues: DEVELOPMENT_PRIORITIES,
  purpose: "Read-only machine access to the complete Carnival Development Console roadmap.",
  sequenceSemantics: "Features are returned in canonical global development order; null sequence sorts last.",
  statusValues: DEVELOPMENT_STATUSES,
  writeAccess: false,
} as const;
