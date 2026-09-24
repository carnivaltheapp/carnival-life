import "server-only";

import { developmentComponentSlug } from "../../domain/development-component-slug";
import type { DevelopmentFeature } from "../../domain/development-feature";
import { MongoDevelopmentFeatureRepository } from "./repository";
import { buildRoadmap } from "./roadmap";

export type PublicDevelopmentFeature = {
  component: string;
  dependencies: Array<{ featureId: string; title: string }>;
  description: string;
  featureId: string;
  notes: string;
  priority: string;
  sequence: number | null;
  status: string;
  title: string;
  updatedAt: string;
};

export type PublicDevelopmentComponent = {
  features: PublicDevelopmentFeature[];
  name: string;
  slug: string;
};

export type PublicDevelopmentRoadmap = {
  features: PublicDevelopmentFeature[];
};

type PublicFeatureRepository = Pick<
  MongoDevelopmentFeatureRepository,
  "get" | "getByHumanFeatureId" | "list" | "listComponents" | "machineRoadmapOwner"
>;

function publicFeature(
  feature: DevelopmentFeature,
  dependencies: PublicDevelopmentFeature["dependencies"],
): PublicDevelopmentFeature {
  return {
    component: feature.component,
    dependencies,
    description: feature.description,
    featureId: feature.featureId,
    notes: feature.notes,
    priority: feature.priority,
    sequence: feature.sequence,
    status: feature.status,
    title: feature.title,
    updatedAt: feature.updatedAt,
  };
}

function publicFeatures(features: DevelopmentFeature[]) {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  return features.map((feature) => publicFeature(
    feature,
    feature.dependencies.flatMap((dependencyId) => {
      const dependency = byId.get(dependencyId);
      return dependency ? [{ featureId: dependency.featureId, title: dependency.title }] : [];
    }),
  ));
}

export async function loadOwnerRoadmap(ownerUserId: string) {
  const repository = new MongoDevelopmentFeatureRepository();
  const [components, features] = await Promise.all([
    repository.listComponents(ownerUserId),
    repository.list(ownerUserId),
  ]);
  return buildRoadmap(components, features);
}

export async function loadMachineRoadmap() {
  const repository = new MongoDevelopmentFeatureRepository();
  const ownerUserId = await repository.machineRoadmapOwner();
  if (!ownerUserId) return null;
  await repository.ensureDevelopmentData(ownerUserId);
  return loadOwnerRoadmap(ownerUserId);
}

export async function loadPublicDevelopmentFeature(
  reference: string,
  repository: PublicFeatureRepository = new MongoDevelopmentFeatureRepository(),
): Promise<PublicDevelopmentFeature | null> {
  const ownerUserId = await repository.machineRoadmapOwner();
  if (!ownerUserId) return null;
  const feature = await repository.getByHumanFeatureId(ownerUserId, reference);
  if (!feature) return null;
  const dependencyRecords = await Promise.all(
    feature.dependencies.map((dependencyId) => repository.get(ownerUserId, dependencyId)),
  );
  return publicFeature(feature, dependencyRecords.flatMap((dependency) => dependency
      ? [{ featureId: dependency.featureId, title: dependency.title }]
      : []));
}

export async function loadPublicDevelopmentComponent(
  requestedSlug: string,
  repository: PublicFeatureRepository = new MongoDevelopmentFeatureRepository(),
): Promise<PublicDevelopmentComponent | null> {
  const ownerUserId = await repository.machineRoadmapOwner();
  if (!ownerUserId) return null;
  const components = await repository.listComponents(ownerUserId);
  const matches = components.filter(
    (component) => developmentComponentSlug(component.name) === requestedSlug,
  );
  if (matches.length !== 1) return null;
  const component = matches[0];
  const allFeatures = await repository.list(ownerUserId);
  return {
    features: publicFeatures(allFeatures).filter((_, index) =>
      allFeatures[index].componentId === component.id),
    name: component.name,
    slug: requestedSlug,
  };
}

export async function loadPublicDevelopmentRoadmap(
  repository: PublicFeatureRepository = new MongoDevelopmentFeatureRepository(),
): Promise<PublicDevelopmentRoadmap | null> {
  const ownerUserId = await repository.machineRoadmapOwner();
  if (!ownerUserId) return null;
  return { features: publicFeatures(await repository.list(ownerUserId)) };
}
