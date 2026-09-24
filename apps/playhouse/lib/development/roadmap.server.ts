import "server-only";

import { MongoDevelopmentFeatureRepository } from "./repository";
import { buildRoadmap } from "./roadmap";

export async function loadMachineRoadmap() {
  const repository = new MongoDevelopmentFeatureRepository();
  const ownerUserId = await repository.machineRoadmapOwner();
  if (!ownerUserId) return null;
  await repository.ensureDevelopmentData(ownerUserId);
  const [components, features] = await Promise.all([
    repository.listComponents(ownerUserId),
    repository.list(ownerUserId),
  ]);
  return buildRoadmap(components, features);
}
