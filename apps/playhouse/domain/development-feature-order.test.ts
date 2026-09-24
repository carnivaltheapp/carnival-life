import { describe, expect, it } from "vitest";

import type { DevelopmentFeature } from "./development-feature";
import {
  moveDevelopmentFeature,
  parseDevelopmentFeatureOrder,
  reorderVisibleDevelopmentFeatures,
} from "./development-feature-order";

const ids = [
  "2eb76847-7998-4a10-8f58-629d3447f1d4",
  "205d0598-b93c-49e1-aec3-4dac945e6e0a",
  "59b66238-f021-4bbb-94ee-d7b7fed800a6",
  "58e924f8-6655-49a0-acba-e1855d3135ba",
];

function feature(index: number, componentId = "684fa2ea-3077-47a4-b288-0ecf634ddf5f"): DevelopmentFeature {
  return {
    component: componentId.endsWith("5f") ? "PlayHouse" : "Gmail",
    componentId,
    createdAt: `2026-09-24T12:0${index}:00.000Z`,
    dependencies: [],
    description: `Feature ${index}`,
    id: ids[index],
    notes: "",
    priority: index === 0 ? "High" : "Low",
    sequence: index + 1,
    status: "Planned",
    title: `Feature ${index}`,
    updatedAt: `2026-09-24T12:0${index}:00.000Z`,
  };
}

describe("development feature ordering", () => {
  it("moves a feature upward and downward", () => {
    const features = [feature(0), feature(1), feature(2)];
    expect(moveDevelopmentFeature(features, ids[2], ids[0], "before")).toEqual([ids[2], ids[0], ids[1]]);
    expect(moveDevelopmentFeature(features, ids[0], ids[2], "after")).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("merges a component-only reorder into global sequence without moving unrelated records", () => {
    const gmail = "e6e439d1-b237-407d-86dc-86baa8366592";
    const features = [feature(0, gmail), feature(1), feature(2, gmail), feature(3)];
    const reordered = reorderVisibleDevelopmentFeatures(features, [ids[2], ids[0]]);
    expect(reordered?.map((item) => item.id)).toEqual([ids[2], ids[1], ids[0], ids[3]]);
    expect(reordered?.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
    expect(reordered?.find((item) => item.id === ids[0])?.priority).toBe("High");
  });

  it("validates an exact unique stable-ID order payload", () => {
    expect(parseDevelopmentFeatureOrder({ featureIds: ids })).toEqual(ids);
    expect(parseDevelopmentFeatureOrder({ featureIds: [ids[0], ids[0]] })).toBeNull();
  });
});
