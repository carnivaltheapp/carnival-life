import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import {
  filterRoadmap,
  roadmapFeatureWithContext,
  type RoadmapResponse,
} from "./roadmap";
import { loadOwnerRoadmap } from "./roadmap.server";

const featureSummarySchema = z.object({
  featureId: z.string(),
  title: z.string(),
});
const dependencySchema = featureSummarySchema.extend({ id: z.string() });
const featureSchema = z.object({
  component: z.string(),
  componentId: z.string(),
  createdAt: z.string(),
  dependencies: z.array(dependencySchema),
  description: z.string(),
  featureId: z.string(),
  id: z.string(),
  notes: z.string(),
  priority: z.string(),
  sequence: z.number().nullable(),
  status: z.string(),
  title: z.string(),
  updatedAt: z.string(),
});
const contextualFeatureSchema = featureSchema.extend({
  nextFeature: featureSummarySchema.nullable(),
  previousFeature: featureSummarySchema.nullable(),
});
const componentSchema = z.object({
  createdAt: z.string(),
  hidden: z.boolean(),
  icon: z.string(),
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  updatedAt: z.string(),
});
const readOnlyAnnotations = {
  destructiveHint: false,
  openWorldHint: false,
  readOnlyHint: true,
} as const;
const oauthMetadata = {
  securitySchemes: [{ scopes: ["openid", "email", "profile"], type: "oauth2" }],
};

type RoadmapLoader = (ownerUserId: string) => Promise<RoadmapResponse>;

function result<T extends Record<string, unknown>>(value: T, summary: string) {
  return {
    content: [{ text: summary, type: "text" as const }],
    structuredContent: value,
  };
}

export function createRoadmapMcpServer(
  ownerUserId: string,
  loadRoadmap: RoadmapLoader = loadOwnerRoadmap,
) {
  const server = new McpServer(
    { name: "carnival-development-roadmap", version: "1.0.0" },
    {
      instructions:
        "Use get_feature whenever the user references CF-###. Use get_roadmap for sequence or dependency analysis across features. All tools are read-only and return current Mongo-backed Development Console data.",
    },
  );

  server.registerTool("get_feature", {
    _meta: oauthMetadata,
    annotations: readOnlyAnnotations,
    description:
      "Retrieve the current Carnival Development Console feature identified by its CF-### reference. Use whenever the user references a Carnival feature ID such as CF-010.",
    inputSchema: { featureId: z.string().describe("Canonical Carnival feature reference, such as CF-010") },
    outputSchema: {
      feature: contextualFeatureSchema.nullable(),
      found: z.boolean(),
    },
    title: "Get Carnival feature",
  }, async ({ featureId }) => {
    const feature = roadmapFeatureWithContext(await loadRoadmap(ownerUserId), featureId);
    return result(
      { feature, found: Boolean(feature) },
      feature ? `Retrieved ${feature.featureId}: ${feature.title}` : `Carnival feature ${featureId} was not found.`,
    );
  });

  server.registerTool("search_features", {
    _meta: oauthMetadata,
    annotations: readOnlyAnnotations,
    description: "Search current Carnival Development Console features by CF ID, title, description, component, and Notes.",
    inputSchema: { query: z.string().min(1) },
    outputSchema: { features: z.array(featureSchema) },
    title: "Search Carnival features",
  }, async ({ query }) => {
    const features = filterRoadmap(await loadRoadmap(ownerUserId), { q: query }).features;
    return result({ features }, `Found ${features.length} Carnival feature${features.length === 1 ? "" : "s"}.`);
  });

  server.registerTool("list_features", {
    _meta: oauthMetadata,
    annotations: readOnlyAnnotations,
    description: "List current Carnival Development Console features, optionally filtered by component, status, or priority.",
    inputSchema: {
      component: z.string().optional(),
      priority: z.string().optional(),
      status: z.string().optional(),
    },
    outputSchema: { features: z.array(featureSchema) },
    title: "List Carnival features",
  }, async (filters) => {
    const features = filterRoadmap(await loadRoadmap(ownerUserId), filters).features;
    return result({ features }, `Listed ${features.length} Carnival feature${features.length === 1 ? "" : "s"}.`);
  });

  server.registerTool("list_components", {
    _meta: oauthMetadata,
    annotations: readOnlyAnnotations,
    description: "List current Carnival Development Console components, including hidden components and their canonical navigation order.",
    outputSchema: { components: z.array(componentSchema) },
    title: "List Carnival components",
  }, async () => {
    const components = (await loadRoadmap(ownerUserId)).components;
    return result({ components }, `Listed ${components.length} Carnival component${components.length === 1 ? "" : "s"}.`);
  });

  server.registerTool("get_roadmap", {
    _meta: oauthMetadata,
    annotations: readOnlyAnnotations,
    description: "Retrieve the current ordered Carnival Development roadmap when reasoning about development sequence, priorities, components, or dependencies across multiple features.",
    outputSchema: {
      components: z.array(componentSchema),
      dependencies: z.array(z.object({ dependsOnFeatureId: z.string(), featureId: z.string() })),
      features: z.array(featureSchema),
      globalSequence: z.array(z.string()),
    },
    title: "Get Carnival roadmap",
  }, async () => {
    const roadmap = await loadRoadmap(ownerUserId);
    return result(roadmap, `Retrieved the current Carnival roadmap with ${roadmap.features.length} features.`);
  });

  return server;
}
