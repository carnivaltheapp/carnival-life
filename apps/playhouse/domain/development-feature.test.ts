import { describe, expect, it } from "vitest";

import {
  filterDevelopmentFeatures,
  parseDevelopmentFeatureInput,
  sortDevelopmentFeatures,
  type DevelopmentFeature,
} from "./development-feature";

const features: DevelopmentFeature[] = [
  {
    component: "Gmail",
    createdAt: "2026-09-24T10:00:00.000Z",
    dependencies: [],
    description: "Attach an open conversation",
    id: "34a28cb5-e40d-4da5-98b3-69d8de358c4d",
    notes: "Bridge contract",
    priority: "High",
    sequence: 2,
    status: "Building",
    title: "Gmail bridge",
    updatedAt: "2026-09-24T10:00:00.000Z",
  },
  {
    component: "PlayHouse",
    createdAt: "2026-09-24T09:00:00.000Z",
    dependencies: [],
    description: "Reusable Play defaults",
    id: "13790f39-b3d8-418d-b0eb-d11d483b1b36",
    notes: "Keep the form compact",
    priority: "Medium",
    sequence: 1,
    status: "Ready",
    title: "Play templates",
    updatedAt: "2026-09-24T09:00:00.000Z",
  },
  {
    component: "Carnival AI",
    createdAt: "2026-09-24T08:00:00.000Z",
    dependencies: [],
    description: "Future assistance",
    id: "98431bd0-e1b0-4106-8991-a0ca5630ea55",
    notes: "Not in the current phase",
    priority: "Low",
    sequence: null,
    status: "Idea",
    title: "AI helper",
    updatedAt: "2026-09-24T08:00:00.000Z",
  },
];

describe("Carnival Development feature domain", () => {
  it("sorts lower manual sequences first and leaves unsequenced features last", () => {
    expect(sortDevelopmentFeatures(features).map((feature) => feature.title)).toEqual([
      "Play templates",
      "Gmail bridge",
      "AI helper",
    ]);
  });

  it("combines component, status, priority, and free-text filters", () => {
    expect(filterDevelopmentFeatures(features, {
      component: "Gmail",
      priority: "High",
      query: "contract",
      status: "Building",
    }).map((feature) => feature.title)).toEqual(["Gmail bridge"]);
    expect(filterDevelopmentFeatures(features, {
      component: "All Features",
      priority: "All Priorities",
      query: "reusable",
      status: "All Statuses",
    }).map((feature) => feature.title)).toEqual(["Play templates"]);
  });

  it("validates persisted sequence and dependency fields without accepting arbitrary values", () => {
    const parsed = parseDevelopmentFeatureInput({
      component: "PlayHouse",
      dependencies: [features[0].id],
      description: "A complete description",
      notes: "Some notes",
      priority: "Medium",
      sequence: "12",
      status: "Planned",
      title: "A feature",
    });
    expect(parsed).toEqual({
      input: expect.objectContaining({ dependencies: [features[0].id], sequence: 12 }),
      ok: true,
    });
    expect(parseDevelopmentFeatureInput({
      component: "Unknown",
      dependencies: [],
      description: "Description",
      priority: "Medium",
      sequence: null,
      status: "Idea",
      title: "Title",
    })).toEqual({ error: "Choose a valid component.", ok: false });
  });
});
