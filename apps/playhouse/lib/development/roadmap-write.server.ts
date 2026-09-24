import "server-only";

import {
  normalizeDevelopmentFeatureId,
  parseDevelopmentFeatureInput,
  sortDevelopmentFeatures,
  type DevelopmentFeature,
  type DevelopmentFeatureInput,
} from "../../domain/development-feature";
import { MongoDevelopmentFeatureRepository } from "./repository";
import { buildRoadmap, type RoadmapResponse } from "./roadmap";

type FeatureChanges = Partial<Pick<
  DevelopmentFeature,
  "description" | "notes" | "priority" | "status" | "title"
>> & { component?: string };

type RoadmapWriteRepository = Pick<
  MongoDevelopmentFeatureRepository,
  | "dependenciesExist"
  | "getByHumanFeatureId"
  | "list"
  | "listComponents"
  | "reorderFeatures"
  | "update"
>;

export class RoadmapWriteError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RoadmapWriteError";
  }
}

function canonicalFeatureId(reference: string) {
  const featureId = normalizeDevelopmentFeatureId(reference);
  if (!featureId) throw new RoadmapWriteError("feature_id_invalid", "Use a valid CF-### feature ID.");
  return featureId;
}

export class RoadmapWriteService {
  constructor(
    private readonly repository: RoadmapWriteRepository = new MongoDevelopmentFeatureRepository(),
  ) {}

  private async feature(ownerUserId: string, reference: string) {
    const featureId = canonicalFeatureId(reference);
    const feature = await this.repository.getByHumanFeatureId(ownerUserId, featureId);
    if (!feature) throw new RoadmapWriteError("feature_not_found", `${featureId} was not found.`);
    return feature;
  }

  private async roadmap(ownerUserId: string): Promise<RoadmapResponse> {
    const [components, features] = await Promise.all([
      this.repository.listComponents(ownerUserId),
      this.repository.list(ownerUserId),
    ]);
    return buildRoadmap(components, features);
  }

  private async update(
    ownerUserId: string,
    feature: DevelopmentFeature,
    overrides: Partial<DevelopmentFeatureInput>,
  ) {
    const parsed = parseDevelopmentFeatureInput({
      componentId: feature.componentId,
      dependencies: feature.dependencies,
      description: feature.description,
      notes: feature.notes,
      priority: feature.priority,
      sequence: feature.sequence,
      status: feature.status,
      title: feature.title,
      ...overrides,
    });
    if (!parsed.ok) throw new RoadmapWriteError("feature_invalid", parsed.error);
    if (!await this.repository.dependenciesExist(ownerUserId, parsed.input.dependencies, feature.id)) {
      throw new RoadmapWriteError("dependency_invalid", "One or more dependencies are invalid.");
    }
    const updated = await this.repository.update(ownerUserId, feature.id, parsed.input);
    if (!updated) throw new RoadmapWriteError("feature_update_failed", "The feature could not be updated.");
    return this.roadmap(ownerUserId);
  }

  async updateFeature(ownerUserId: string, reference: string, changes: FeatureChanges) {
    const feature = await this.feature(ownerUserId, reference);
    let componentId = feature.componentId;
    if (changes.component !== undefined) {
      const requested = changes.component.trim().toLocaleLowerCase();
      const component = (await this.repository.listComponents(ownerUserId)).find((item) =>
        item.id === changes.component || item.name.toLocaleLowerCase() === requested);
      if (!component) throw new RoadmapWriteError("component_not_found", "Choose an existing component.");
      componentId = component.id;
    }
    const allowedChanges: Partial<DevelopmentFeatureInput> = {};
    if (changes.description !== undefined) allowedChanges.description = changes.description;
    if (changes.notes !== undefined) allowedChanges.notes = changes.notes;
    if (changes.priority !== undefined) allowedChanges.priority = changes.priority;
    if (changes.status !== undefined) allowedChanges.status = changes.status;
    if (changes.title !== undefined) allowedChanges.title = changes.title;
    return this.update(ownerUserId, feature, { ...allowedChanges, componentId });
  }

  async reorderFeature(ownerUserId: string, reference: string, sequence: number) {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new RoadmapWriteError("sequence_invalid", "Sequence must be a positive whole number.");
    }
    const target = await this.feature(ownerUserId, reference);
    const ordered = sortDevelopmentFeatures(await this.repository.list(ownerUserId));
    if (sequence > ordered.length) {
      throw new RoadmapWriteError("sequence_invalid", `Sequence must be between 1 and ${ordered.length}.`);
    }
    const withoutTarget = ordered.filter((feature) => feature.id !== target.id);
    withoutTarget.splice(sequence - 1, 0, target);
    if (!await this.repository.reorderFeatures(ownerUserId, withoutTarget.map((feature) => feature.id))) {
      throw new RoadmapWriteError("feature_reorder_failed", "The feature order could not be saved.");
    }
    return this.roadmap(ownerUserId);
  }

  async addDependency(ownerUserId: string, reference: string, dependencyReference: string) {
    const feature = await this.feature(ownerUserId, reference);
    const dependency = await this.feature(ownerUserId, dependencyReference);
    if (feature.id === dependency.id) {
      throw new RoadmapWriteError("dependency_self", "A feature cannot depend on itself.");
    }
    if (feature.dependencies.includes(dependency.id)) {
      throw new RoadmapWriteError("dependency_duplicate", `${dependency.featureId} is already a dependency.`);
    }
    return this.update(ownerUserId, feature, {
      dependencies: [...feature.dependencies, dependency.id],
    });
  }

  async removeDependency(ownerUserId: string, reference: string, dependencyReference: string) {
    const feature = await this.feature(ownerUserId, reference);
    const dependency = await this.feature(ownerUserId, dependencyReference);
    if (!feature.dependencies.includes(dependency.id)) {
      throw new RoadmapWriteError("dependency_missing", `${dependency.featureId} is not a dependency.`);
    }
    return this.update(ownerUserId, feature, {
      dependencies: feature.dependencies.filter((dependencyId) => dependencyId !== dependency.id),
    });
  }

  async appendNotes(ownerUserId: string, reference: string, text: string) {
    if (!text.trim()) throw new RoadmapWriteError("notes_empty", "Notes text cannot be blank.");
    const feature = await this.feature(ownerUserId, reference);
    const notes = feature.notes ? `${feature.notes}\n\n${text}` : text;
    return this.update(ownerUserId, feature, { notes });
  }
}

export type { FeatureChanges };
