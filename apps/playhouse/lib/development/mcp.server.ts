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
  securitySchemes: [{ scopes: ["roadmap:read"], type: "oauth2" }],
};

type RoadmapLoader = (ownerUserId: string) => Promise<RoadmapResponse>;
type RoadmapMcpAccess =
  | { authenticationChallenge: string; ownerUserId?: never }
  | { authenticationChallenge?: never; ownerUserId: string };

function result<T extends Record<string, unknown>>(value: T, summary: string) {
  return {
    content: [{ text: summary, type: "text" as const }],
    structuredContent: value,
  };
}

export function createRoadmapMcpServer(
  access: RoadmapMcpAccess | string,
  loadRoadmap: RoadmapLoader = loadOwnerRoadmap,
) {
  const authorization = typeof access === "string"
    ? { ownerUserId: access }
    : access;
  const authorizedRoadmap = async () => authorization.ownerUserId
    ? loadRoadmap(authorization.ownerUserId)
    : null;
  const authenticationRequired = () => ({
    _meta: {
      "mcp/www_authenticate": [authorization.authenticationChallenge],
    },
    content: [{
      text: "Authentication required: connect Carnival Development Console to continue.",
      type: "text" as const,
    }],
    isError: true,
  });
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
    const roadmap = await authorizedRoadmap();
    if (!roadmap) return authenticationRequired();
    const feature = roadmapFeatureWithContext(roadmap, featureId);
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
    const roadmap = await authorizedRoadmap();
    if (!roadmap) return authenticationRequired();
    const features = filterRoadmap(roadmap, { q: query }).features;
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
    const roadmap = await authorizedRoadmap();
    if (!roadmap) return authenticationRequired();
    const features = filterRoadmap(roadmap, filters).features;
    return result({ features }, `Listed ${features.length} Carnival feature${features.length === 1 ? "" : "s"}.`);
  });

  server.registerTool("list_components", {
    _meta: oauthMetadata,
    annotations: readOnlyAnnotations,
    description: "List current Carnival Development Console components, including hidden components and their canonical navigation order.",
    outputSchema: { components: z.array(componentSchema) },
    title: "List Carnival components",
  }, async () => {
    const roadmap = await authorizedRoadmap();
    if (!roadmap) return authenticationRequired();
    const components = roadmap.components;
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
    const roadmap = await authorizedRoadmap();
    if (!roadmap) return authenticationRequired();
    return result(roadmap, `Retrieved the current Carnival roadmap with ${roadmap.features.length} features.`);
  });

  return server;
}
