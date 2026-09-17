import { createHash } from "node:crypto";

import type { Filter, ObjectId, WithId } from "mongodb";

import { getCarnivalMongoDatabase } from "../playhouse/mongo-client";

export const GMAIL_DIAGNOSTIC_COLLECTION = "carnival_gmail_diagnostics";

export const GMAIL_DIAGNOSTIC_STAGES = [
  "LIST_ROW_POINTERDOWN",
  "LIST_ROW_METADATA_RESOLVED",
  "LIST_ROW_DRAGSTART",
  "DRAG_METADATA_EXTRACTED",
  "DRAG_METADATA_RECEIVED",
  "PLAY_GMAIL_LINK_PERSISTED",
  "GMAIL_NOTIFICATION_RECEIVED",
  "GMAIL_NOTIFICATION_NORMALIZED",
  "GMAIL_MATCH_ATTEMPTED",
  "GMAIL_MATCH_RESULT",
  "PLAY_INCOMING_MUTATION",
  "GMAIL_OUTGOING_SYNC_REQUESTED",
  "GMAIL_OUTGOING_SYNC_RESULT",
] as const;

export type GmailDiagnosticStage = (typeof GMAIL_DIAGNOSTIC_STAGES)[number];
export type GmailExtractionStrategy = "ancestor" | "conversation_header" | "direct" | "missing";
export type GmailDragSource = "list_row" | "opened_conversation";
export type GmailMatchResult = "ambiguous" | "matched" | "unmatched";
export type GmailMatchStrategy =
  | "api_thread_attachment"
  | "api_thread_canonical"
  | "legacy_message_id"
  | "legacy_thread_id"
  | "none";
export type GmailOutgoingOperation = "star" | "unstar";

export type GmailDiagnosticInput = {
  ancestorDepth?: number;
  ancestorRoles?: string[];
  ancestorTags?: string[];
  apiThreadPresent?: boolean;
  clickableMessageLinkPresent?: boolean;
  correlationId?: string | null;
  dataLegacyThreadAttributePresent?: boolean;
  dataMessageAttributePresent?: boolean;
  dataThreadAttributePresent?: boolean;
  draggableTargetPresent?: boolean;
  draggableAncestorPresent?: boolean;
  draggableAttributePresent?: boolean;
  extractionStrategy?: GmailExtractionStrategy;
  fired?: boolean;
  handlerReached?: boolean;
  matchResult?: GmailMatchResult;
  matchStrategy?: GmailMatchStrategy;
  mutationAttempted?: boolean;
  metadataReady?: boolean;
  operation?: GmailOutgoingOperation;
  ownerUserId: string;
  playId?: string | null;
  reason?: string | null;
  rolePresent?: boolean;
  rowRecognized?: boolean;
  resultDate?: string | null;
  resultPriority?: string | null;
  resultTaskType?: string | null;
  source?: GmailDragSource;
  success?: boolean;
  stage: GmailDiagnosticStage;
  threadId?: string | null;
  targetRole?: string | null;
  targetTag?: string | null;
  webThreadPresent?: boolean;
};

export type GmailDiagnosticDocument = {
  _id?: ObjectId;
  ancestor_depth?: number;
  ancestor_roles?: string[];
  ancestor_tags?: string[];
  api_thread_present?: boolean;
  clickable_message_link_present?: boolean;
  correlation_id?: string;
  created_at: Date;
  data_legacy_thread_attribute_present?: boolean;
  data_message_attribute_present?: boolean;
  data_thread_attribute_present?: boolean;
  draggable_ancestor_present?: boolean;
  draggable_attribute_present?: boolean;
  draggable_target_present?: boolean;
  extraction_strategy?: GmailExtractionStrategy;
  fired?: boolean;
  handler_reached?: boolean;
  identifier_type?: "gmail_api_thread_id";
  match_result?: GmailMatchResult;
  match_strategy?: GmailMatchStrategy;
  mutation_attempted?: boolean;
  metadata_ready?: boolean;
  operation?: GmailOutgoingOperation;
  owner_user_id: string;
  play_id?: string;
  reason?: string;
  role_present?: boolean;
  row_recognized?: boolean;
  result_date?: string;
  result_priority?: string;
  result_task_type?: string;
  source?: GmailDragSource;
  stage: GmailDiagnosticStage;
  success?: boolean;
  thread_fingerprint?: string;
  target_role?: string;
  target_tag?: string;
  web_thread_present?: boolean;
};

export type GmailDiagnosticQuery = {
  limit?: number;
  ownerUserId: string;
  playId?: string | null;
  reason?: string | null;
  stage?: GmailDiagnosticStage | null;
  threadFingerprint?: string | null;
};

function safeText(value: string | null | undefined, maxLength = 200) {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function gmailThreadFingerprint(threadId: string | null | undefined) {
  const normalized = safeText(threadId, 500);
  return normalized
    ? createHash("sha256").update(normalized, "utf8").digest("hex")
    : null;
}

export function gmailDiagnosticDocument(
  input: GmailDiagnosticInput,
  now = new Date(),
): GmailDiagnosticDocument {
  const correlationId = safeText(input.correlationId, 100);
  const playId = safeText(input.playId, 100);
  const reason = safeText(input.reason, 100);
  const resultDate = safeText(input.resultDate, 10);
  const resultPriority = safeText(input.resultPriority, 100);
  const resultTaskType = safeText(input.resultTaskType, 10);
  const threadFingerprint = gmailThreadFingerprint(input.threadId);
  const ancestorTags = input.ancestorTags?.filter((tag) => /^[A-Z][A-Z0-9-]{0,19}$/.test(tag))
    .slice(0, 7);
  const ancestorRoles = input.ancestorRoles?.filter((role) => (
    /^(button|checkbox|gridcell|link|main|none|other|presentation|row)$/.test(role)
  )).slice(0, 7);
  const requestedTargetRole = safeText(input.targetRole, 20);
  const targetRole = requestedTargetRole &&
    /^(button|checkbox|gridcell|link|main|other|presentation|row)$/.test(requestedTargetRole)
    ? requestedTargetRole
    : null;
  const requestedTargetTag = safeText(input.targetTag, 20);
  const targetTag = requestedTargetTag && /^[A-Z][A-Z0-9-]{0,19}$/.test(requestedTargetTag)
    ? requestedTargetTag
    : null;
  return {
    created_at: now,
    owner_user_id: input.ownerUserId,
    stage: input.stage,
    ...(Number.isSafeInteger(input.ancestorDepth) && input.ancestorDepth! >= 0
      ? { ancestor_depth: Math.min(input.ancestorDepth!, 6) }
      : {}),
    ...(ancestorTags?.length ? { ancestor_tags: ancestorTags } : {}),
    ...(ancestorRoles?.length ? { ancestor_roles: ancestorRoles } : {}),
    ...(typeof input.apiThreadPresent === "boolean"
      ? { api_thread_present: input.apiThreadPresent }
      : {}),
    ...(correlationId ? { correlation_id: correlationId } : {}),
    ...(typeof input.clickableMessageLinkPresent === "boolean"
      ? { clickable_message_link_present: input.clickableMessageLinkPresent }
      : {}),
    ...(typeof input.dataLegacyThreadAttributePresent === "boolean"
      ? { data_legacy_thread_attribute_present: input.dataLegacyThreadAttributePresent }
      : {}),
    ...(typeof input.dataMessageAttributePresent === "boolean"
      ? { data_message_attribute_present: input.dataMessageAttributePresent }
      : {}),
    ...(typeof input.dataThreadAttributePresent === "boolean"
      ? { data_thread_attribute_present: input.dataThreadAttributePresent }
      : {}),
    ...(typeof input.draggableAncestorPresent === "boolean"
      ? { draggable_ancestor_present: input.draggableAncestorPresent }
      : {}),
    ...(typeof input.draggableAttributePresent === "boolean"
      ? { draggable_attribute_present: input.draggableAttributePresent }
      : {}),
    ...(typeof input.draggableTargetPresent === "boolean"
      ? { draggable_target_present: input.draggableTargetPresent }
      : {}),
    ...(input.extractionStrategy ? { extraction_strategy: input.extractionStrategy } : {}),
    ...(typeof input.fired === "boolean" ? { fired: input.fired } : {}),
    ...(typeof input.handlerReached === "boolean"
      ? { handler_reached: input.handlerReached }
      : {}),
    ...(input.matchResult ? { match_result: input.matchResult } : {}),
    ...(input.matchStrategy ? { match_strategy: input.matchStrategy } : {}),
    ...(typeof input.mutationAttempted === "boolean"
      ? { mutation_attempted: input.mutationAttempted }
      : {}),
    ...(typeof input.metadataReady === "boolean" ? { metadata_ready: input.metadataReady } : {}),
    ...(input.operation ? { operation: input.operation } : {}),
    ...(playId ? { play_id: playId } : {}),
    ...(reason ? { reason } : {}),
    ...(typeof input.rolePresent === "boolean" ? { role_present: input.rolePresent } : {}),
    ...(typeof input.rowRecognized === "boolean"
      ? { row_recognized: input.rowRecognized }
      : {}),
    ...(resultDate ? { result_date: resultDate } : {}),
    ...(resultPriority ? { result_priority: resultPriority } : {}),
    ...(resultTaskType ? { result_task_type: resultTaskType } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(typeof input.success === "boolean" ? { success: input.success } : {}),
    ...(threadFingerprint
      ? { identifier_type: "gmail_api_thread_id" as const, thread_fingerprint: threadFingerprint }
      : {}),
    ...(targetRole ? { target_role: targetRole } : {}),
    ...(targetTag ? { target_tag: targetTag } : {}),
    ...(typeof input.webThreadPresent === "boolean"
      ? { web_thread_present: input.webThreadPresent }
      : {}),
  };
}

async function defaultCollection() {
  return (await getCarnivalMongoDatabase())
    .collection<GmailDiagnosticDocument>(GMAIL_DIAGNOSTIC_COLLECTION);
}

export class MongoGmailDiagnosticRepository {
  constructor(private readonly collectionFactory = defaultCollection) {}

  async record(input: GmailDiagnosticInput, now = new Date()) {
    const collection = await this.collectionFactory();
    await collection.insertOne(gmailDiagnosticDocument(input, now));
  }

  async list({
    limit = 100,
    ownerUserId,
    playId,
    reason,
    stage,
    threadFingerprint,
  }: GmailDiagnosticQuery) {
    const collection = await this.collectionFactory();
    const filter: Filter<GmailDiagnosticDocument> = { owner_user_id: ownerUserId };
    const normalizedPlayId = safeText(playId, 100);
    const normalizedReason = safeText(reason, 100);
    const normalizedFingerprint = safeText(threadFingerprint, 64);
    if (normalizedPlayId) filter.play_id = normalizedPlayId;
    if (normalizedReason) filter.reason = normalizedReason;
    if (stage) filter.stage = stage;
    if (normalizedFingerprint) filter.thread_fingerprint = normalizedFingerprint;
    const documents = await collection.find(filter, {
      projection: { owner_user_id: 0 },
    }).sort({ created_at: -1, _id: -1 }).limit(Math.min(Math.max(limit, 1), 500)).toArray();
    return documents.reverse().map((document: WithId<GmailDiagnosticDocument>) => {
      const { _id, owner_user_id: _ownerUserId, ...safeDocument } = document;
      void _ownerUserId;
      return { id: _id.toHexString(), ...safeDocument };
    });
  }
}

export async function recordGmailDiagnostic(input: GmailDiagnosticInput) {
  try {
    await new MongoGmailDiagnosticRepository().record(input);
    return true;
  } catch {
    console.warn("CARNIVAL_GMAIL_DIAGNOSTIC RECORD_FAILED", {
      stage: input.stage,
    });
    return false;
  }
}
