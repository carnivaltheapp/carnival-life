import "server-only";

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

type PublicFeatureRepository = Pick<
  MongoDevelopmentFeatureRepository,
  "get" | "getByHumanFeatureId" | "machineRoadmapOwner"
>;

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
  return {
    component: feature.component,
    dependencies: dependencyRecords.flatMap((dependency) => dependency
      ? [{ featureId: dependency.featureId, title: dependency.title }]
      : []),
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
