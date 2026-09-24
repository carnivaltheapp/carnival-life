import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import {
  DEVELOPMENT_PRIORITIES,
  DEVELOPMENT_STATUSES,
} from "../../domain/development-feature";
import {
  filterRoadmap,
  roadmapFeatureWithContext,
  type RoadmapResponse,
} from "./roadmap";
import { loadOwnerRoadmap } from "./roadmap.server";
import {
  RoadmapWriteError,
  RoadmapWriteService,
  type FeatureChanges,
} from "./roadmap-write.server";

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
  securitySchemes: [{ scopes: ["roadmap:read", "roadmap:write"], type: "oauth2" }],
};
const writeAnnotations = {
  destructiveHint: false,
  openWorldHint: false,
  readOnlyHint: false,
} as const;

type RoadmapLoader = (ownerUserId: string) => Promise<RoadmapResponse>;
type RoadmapWriter = Pick<
  RoadmapWriteService,
  "addDependency" | "appendNotes" | "removeDependency" | "reorderFeature" | "updateFeature"
>;
type RoadmapMcpAccess = {
  ownerUserId?: string;
  readAuthenticationChallenge?: string;
  scopes?: string[];
  writeAuthenticationChallenge?: string;
};

function result<T extends Record<string, unknown>>(value: T, summary: string) {
  return {
    content: [{ text: summary, type: "text" as const }],
    structuredContent: value,
  };
}

export function createRoadmapMcpServer(
  access: RoadmapMcpAccess | string,
  loadRoadmap: RoadmapLoader = loadOwnerRoadmap,
  writer: RoadmapWriter = new RoadmapWriteService(),
) {
  const authorization = typeof access === "string"
    ? { ownerUserId: access, scopes: ["roadmap:read", "roadmap:write"] }
    : access;
  const hasScope = (scope: "roadmap:read" | "roadmap:write") =>
    Boolean(authorization.ownerUserId && authorization.scopes?.includes(scope));
  const authorizedRoadmap = async () => hasScope("roadmap:read") && authorization.ownerUserId
    ? loadRoadmap(authorization.ownerUserId)
    : null;
  const authenticationRequired = (scope: "roadmap:read" | "roadmap:write") => ({
    _meta: {
      "mcp/www_authenticate": [scope === "roadmap:write"
        ? authorization.writeAuthenticationChallenge
        : authorization.readAuthenticationChallenge].filter(Boolean),
    },
    content: [{
      text: scope === "roadmap:write"
        ? "Write authorization required: reconnect Carnival Development Console with roadmap:write permission."
        : "Authentication required: connect Carnival Development Console to continue.",
      type: "text" as const,
    }],
    isError: true,
  });
  const mutationFailed = (error: unknown) => ({
    content: [{
      text: error instanceof RoadmapWriteError ? error.message : "The Carnival roadmap change could not be completed.",
      type: "text" as const,
    }],
    isError: true,
  });
  const updatedFeature = (roadmap: RoadmapResponse, featureId: string) => {
    const feature = roadmapFeatureWithContext(roadmap, featureId);
    if (!feature) throw new RoadmapWriteError("feature_update_failed", "The updated feature could not be loaded.");
    return result({ feature }, `Updated ${feature.featureId}: ${feature.title}`);
  };
  const server = new McpServer(
    { name: "carnival-development-roadmap", version: "1.1.0" },
    {
      instructions:
        "Use get_feature whenever the user references CF-###. Use get_roadmap for sequence or dependency analysis. Use write tools only when the user explicitly requests a Development Console change; never mutate the roadmap merely because a change is discussed or recommended.",
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
    if (!roadmap) return authenticationRequired("roadmap:read");
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
    if (!roadmap) return authenticationRequired("roadmap:read");
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
    if (!roadmap) return authenticationRequired("roadmap:read");
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
    if (!roadmap) return authenticationRequired("roadmap:read");
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
    if (!roadmap) return authenticationRequired("roadmap:read");
    return result(roadmap, `Retrieved the current Carnival roadmap with ${roadmap.features.length} features.`);
  });

  const writeDescription = "Use only when the user explicitly requests this exact Development Console change. Never use for suggestions, planning discussion, or inferred preferences.";

  server.registerTool("update_feature", {
    _meta: oauthMetadata,
    annotations: writeAnnotations,
    description: `Update approved editable fields on an existing Carnival feature. ${writeDescription}`,
    inputSchema: {
      changes: z.object({
        component: z.string().min(1).optional(),
        description: z.string().optional(),
        notes: z.string().optional(),
        priority: z.enum(DEVELOPMENT_PRIORITIES).optional(),
        status: z.enum(DEVELOPMENT_STATUSES).optional(),
        title: z.string().optional(),
      }).strict().refine((changes) => Object.keys(changes).length > 0, "At least one change is required."),
      featureId: z.string().describe("Canonical Carnival feature reference, such as CF-012"),
    },
    outputSchema: { feature: contextualFeatureSchema },
    title: "Update Carnival feature",
  }, async ({ changes, featureId }) => {
    if (!hasScope("roadmap:write") || !authorization.ownerUserId) {
      return authenticationRequired("roadmap:write");
    }
    try {
      return updatedFeature(
        await writer.updateFeature(authorization.ownerUserId, featureId, changes as FeatureChanges),
        featureId,
      );
    } catch (error) {
      return mutationFailed(error);
    }
  });

  server.registerTool("reorder_feature", {
    _meta: oauthMetadata,
    annotations: writeAnnotations,
    description: `Move one feature to a requested one-based position in the canonical global sequence while preserving the relative order of all other features. ${writeDescription}`,
    inputSchema: {
      featureId: z.string(),
      sequence: z.number().int().positive(),
    },
    outputSchema: { feature: contextualFeatureSchema },
    title: "Reorder Carnival feature",
  }, async ({ featureId, sequence }) => {
    if (!hasScope("roadmap:write") || !authorization.ownerUserId) return authenticationRequired("roadmap:write");
    try {
      return updatedFeature(
        await writer.reorderFeature(authorization.ownerUserId, featureId, sequence),
        featureId,
      );
    } catch (error) {
      return mutationFailed(error);
    }
  });

  server.registerTool("add_dependency", {
    _meta: oauthMetadata,
    annotations: writeAnnotations,
    description: `Add one existing Carnival feature as a dependency of another. Self-dependencies and duplicates are rejected. ${writeDescription}`,
    inputSchema: { dependencyFeatureId: z.string(), featureId: z.string() },
    outputSchema: { feature: contextualFeatureSchema },
    title: "Add Carnival dependency",
  }, async ({ dependencyFeatureId, featureId }) => {
    if (!hasScope("roadmap:write") || !authorization.ownerUserId) return authenticationRequired("roadmap:write");
    try {
      return updatedFeature(
        await writer.addDependency(authorization.ownerUserId, featureId, dependencyFeatureId),
        featureId,
      );
    } catch (error) {
      return mutationFailed(error);
    }
  });

  server.registerTool("remove_dependency", {
    _meta: oauthMetadata,
    annotations: writeAnnotations,
    description: `Remove one existing dependency from a Carnival feature. ${writeDescription}`,
    inputSchema: { dependencyFeatureId: z.string(), featureId: z.string() },
    outputSchema: { feature: contextualFeatureSchema },
    title: "Remove Carnival dependency",
  }, async ({ dependencyFeatureId, featureId }) => {
    if (!hasScope("roadmap:write") || !authorization.ownerUserId) return authenticationRequired("roadmap:write");
    try {
      return updatedFeature(
        await writer.removeDependency(authorization.ownerUserId, featureId, dependencyFeatureId),
        featureId,
      );
    } catch (error) {
      return mutationFailed(error);
    }
  });

  server.registerTool("append_notes", {
    _meta: oauthMetadata,
    annotations: writeAnnotations,
    description: `Append text to an existing feature's Notes with a paragraph break; never replaces existing Notes. ${writeDescription}`,
    inputSchema: { featureId: z.string(), text: z.string().min(1) },
    outputSchema: { feature: contextualFeatureSchema },
    title: "Append Carnival feature Notes",
  }, async ({ featureId, text }) => {
    if (!hasScope("roadmap:write") || !authorization.ownerUserId) return authenticationRequired("roadmap:write");
    try {
      return updatedFeature(
        await writer.appendNotes(authorization.ownerUserId, featureId, text),
        featureId,
      );
    } catch (error) {
      return mutationFailed(error);
    }
  });

  return server;
}
