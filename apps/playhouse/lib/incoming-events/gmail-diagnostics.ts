import { createHash } from "node:crypto";

import type { Filter, ObjectId, WithId } from "mongodb";

import { getCarnivalMongoDatabase } from "../playhouse/mongo-client";

export const GMAIL_DIAGNOSTIC_COLLECTION = "carnival_gmail_diagnostics";

export const GMAIL_DIAGNOSTIC_STAGES = [
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
  "GMAIL_LIFECYCLE_REQUESTED",
  "MONGO_LIFECYCLE_PERSISTED",
  "GMAIL_LIFECYCLE_UNSTAR_RESULT",
  "GMAIL_CREATION_DECISION",
  "MANUAL_GMAIL_LINK_REQUESTED",
  "MANUAL_GMAIL_REPLACE_CONFIRMATION_REQUIRED",
  "MANUAL_GMAIL_REPLACE_CANCELLED",
  "MANUAL_GMAIL_REPLACE_CONFIRMED",
  "MANUAL_GMAIL_LINK_RESULT",
  "MANUAL_GMAIL_REVIVAL",
  "GMAIL_MANUAL_RESTORE_RESULT",
] as const;

export type GmailDiagnosticStage = (typeof GMAIL_DIAGNOSTIC_STAGES)[number];
export type GmailExtractionStrategy = "ancestor" | "conversation_header" | "direct" | "missing";
export type GmailMatchResult = "ambiguous" | "matched" | "unmatched";
export type GmailMatchStrategy =
  | "api_thread_attachment"
  | "api_thread_canonical"
  | "legacy_message_id"
  | "legacy_thread_id"
  | "none";
export type GmailOutgoingOperation = "star" | "unstar";
export type GmailLifecycleAction = "done" | "trash";
export type GmailExistingLifecycle = "active" | "done" | "none" | "trashed";
export type GmailCreationDecision = "create" | "suppress";

export type GmailDiagnosticInput = {
  accountResolved?: boolean;
  action?: GmailLifecycleAction;
  apiThreadPresent?: boolean;
  attempted?: boolean;
  correlationId?: string | null;
  decision?: GmailCreationDecision;
  existingLifecycle?: GmailExistingLifecycle;
  existingThreadId?: string | null;
  existingPlayFound?: boolean;
  extractionStrategy?: GmailExtractionStrategy;
  matchResult?: GmailMatchResult;
  matchStrategy?: GmailMatchStrategy;
  matchedPlayCount?: number;
  matchedPlayIds?: string[];
  mutationAttempted?: boolean;
  finalIsActive?: boolean;
  finalIsDeleted?: boolean;
  operation?: GmailOutgoingOperation;
  ownerUserId: string;
  playId?: string | null;
  priorLifecycle?: "done" | "trashed";
  proposedThreadId?: string | null;
  reason?: string | null;
  resultDate?: string | null;
  resultPriority?: string | null;
  resultTaskType?: string | null;
  success?: boolean;
  targetHadGmailLink?: boolean;
  untrashAttempted?: boolean;
  untrashSuccess?: boolean;
  starAttempted?: boolean;
  starSuccess?: boolean;
  stage: GmailDiagnosticStage;
  threadId?: string | null;
  webThreadPresent?: boolean;
};

export type GmailDiagnosticDocument = {
  _id?: ObjectId;
  account_resolved?: boolean;
  action?: GmailLifecycleAction;
  api_thread_present?: boolean;
  attempted?: boolean;
  correlation_id?: string;
  created_at: Date;
  extraction_strategy?: GmailExtractionStrategy;
  decision?: GmailCreationDecision;
  existing_lifecycle?: GmailExistingLifecycle;
  existing_thread_fingerprint?: string;
  existing_play_found?: boolean;
  final_is_active?: boolean;
  final_is_deleted?: boolean;
  identifier_type?: "gmail_api_thread_id";
  match_result?: GmailMatchResult;
  match_strategy?: GmailMatchStrategy;
  matched_play_count?: number;
  matched_play_ids?: string[];
  mutation_attempted?: boolean;
  operation?: GmailOutgoingOperation;
  owner_user_id: string;
  play_id?: string;
  prior_lifecycle?: "done" | "trashed";
  proposed_thread_fingerprint?: string;
  reason?: string;
  result_date?: string;
  result_priority?: string;
  result_task_type?: string;
  stage: GmailDiagnosticStage;
  success?: boolean;
  target_had_gmail_link?: boolean;
  untrash_attempted?: boolean;
  untrash_success?: boolean;
  star_attempted?: boolean;
  star_success?: boolean;
  thread_fingerprint?: string;
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
  const existingThreadFingerprint = gmailThreadFingerprint(input.existingThreadId);
  const proposedThreadFingerprint = gmailThreadFingerprint(input.proposedThreadId);
  return {
    created_at: now,
    owner_user_id: input.ownerUserId,
    stage: input.stage,
    ...(typeof input.accountResolved === "boolean"
      ? { account_resolved: input.accountResolved }
      : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(typeof input.apiThreadPresent === "boolean"
      ? { api_thread_present: input.apiThreadPresent }
      : {}),
    ...(typeof input.attempted === "boolean" ? { attempted: input.attempted } : {}),
    ...(correlationId ? { correlation_id: correlationId } : {}),
    ...(input.decision ? { decision: input.decision } : {}),
    ...(input.existingLifecycle ? { existing_lifecycle: input.existingLifecycle } : {}),
    ...(existingThreadFingerprint
      ? { existing_thread_fingerprint: existingThreadFingerprint }
      : {}),
    ...(typeof input.existingPlayFound === "boolean"
      ? { existing_play_found: input.existingPlayFound }
      : {}),
    ...(input.extractionStrategy ? { extraction_strategy: input.extractionStrategy } : {}),
    ...(typeof input.finalIsActive === "boolean"
      ? { final_is_active: input.finalIsActive }
      : {}),
    ...(typeof input.finalIsDeleted === "boolean"
      ? { final_is_deleted: input.finalIsDeleted }
      : {}),
    ...(input.matchResult ? { match_result: input.matchResult } : {}),
    ...(input.matchStrategy ? { match_strategy: input.matchStrategy } : {}),
    ...(typeof input.matchedPlayCount === "number"
      ? { matched_play_count: input.matchedPlayCount }
      : {}),
    ...(input.matchedPlayIds?.length
      ? { matched_play_ids: input.matchedPlayIds.map((id) => safeText(id, 100)).filter(Boolean) as string[] }
      : {}),
    ...(typeof input.mutationAttempted === "boolean"
      ? { mutation_attempted: input.mutationAttempted }
      : {}),
    ...(input.operation ? { operation: input.operation } : {}),
    ...(playId ? { play_id: playId } : {}),
    ...(input.priorLifecycle ? { prior_lifecycle: input.priorLifecycle } : {}),
    ...(proposedThreadFingerprint
      ? { proposed_thread_fingerprint: proposedThreadFingerprint }
      : {}),
    ...(reason ? { reason } : {}),
    ...(resultDate ? { result_date: resultDate } : {}),
    ...(resultPriority ? { result_priority: resultPriority } : {}),
    ...(resultTaskType ? { result_task_type: resultTaskType } : {}),
    ...(typeof input.success === "boolean" ? { success: input.success } : {}),
    ...(typeof input.targetHadGmailLink === "boolean"
      ? { target_had_gmail_link: input.targetHadGmailLink }
      : {}),
    ...(typeof input.untrashAttempted === "boolean"
      ? { untrash_attempted: input.untrashAttempted }
      : {}),
    ...(typeof input.untrashSuccess === "boolean"
      ? { untrash_success: input.untrashSuccess }
      : {}),
    ...(typeof input.starAttempted === "boolean"
      ? { star_attempted: input.starAttempted }
      : {}),
    ...(typeof input.starSuccess === "boolean" ? { star_success: input.starSuccess } : {}),
    ...(threadFingerprint
      ? { identifier_type: "gmail_api_thread_id" as const, thread_fingerprint: threadFingerprint }
      : {}),
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
  } catch {
    console.warn("CARNIVAL_GMAIL_DIAGNOSTIC RECORD_FAILED", {
      stage: input.stage,
    });
  }
}
