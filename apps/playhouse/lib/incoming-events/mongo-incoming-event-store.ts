import "server-only";

import {
  MongoServerError,
  ObjectId,
  type Filter,
} from "mongodb";

import type {
  IncomingEventMatch,
  IncomingEventMatchEngine,
  IncomingEventPolicyMutation,
  IncomingEventProcessResult,
  IncomingEventStore,
  NormalizedIncomingEvent,
} from "../../domain/incoming-event";
import { incomingHeadlineGroupOrderUpdates } from "../../domain/incoming-event";
import { gmailThreadUrl } from "../../domain/play-display";
import { recordGmailDiagnostic, type GmailMatchStrategy } from "./gmail-diagnostics";
import {
  getCarnivalMongoClient,
  getCarnivalMongoDatabase,
} from "../playhouse/mongo-client";
import {
  assertMongoUserMapping,
  legacyPriorityNumber,
  legacyPriorityValue,
  mongoActiveFilter,
  type LegacyTaskDocument,
} from "../playhouse/mongo-play-mapping";

const EVENT_COLLECTION = "carnival_incoming_events";

type IncomingEventStatus = "handled" | "unhandled";
type IncomingMatchStatus = IncomingEventMatch["status"];

type IncomingEventDocument = {
  _id?: ObjectId;
  actor: NormalizedIncomingEvent["actor"] | null;
  event_type: string;
  external_event_id: string;
  external_item_id: string | null;
  external_thread_id: string | null;
  handled_at: Date | null;
  linked_play_id: string | null;
  linked_play_ids?: string[];
  match_status: IncomingMatchStatus;
  occurred_at: Date;
  owner_user_id: string;
  received_at: Date;
  routing_url: string | null;
  source: NormalizedIncomingEvent["source"];
  source_metadata: Record<string, unknown>;
  status: IncomingEventStatus;
};

type GmailCandidate = {
  _id: ObjectId;
  carnival_google?: unknown;
  carnival_incoming?: unknown;
  last_id?: unknown;
  message_id?: unknown;
  task_date?: unknown;
  task_type?: unknown;
  thread_id?: unknown;
};

declare global {
  var carnivalIncomingEventIndexPromise: Promise<unknown> | undefined;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function accountIndexAndUrl(candidate: GmailCandidate, apiThreadId: string | null) {
  const attachment = objectValue(objectValue(candidate.carnival_google)?.gmail_attachment);
  const accountIndex = typeof attachment?.account_index === "number" &&
      Number.isSafeInteger(attachment.account_index) && attachment.account_index >= 0
    ? attachment.account_index
    : 0;
  return text(attachment?.canonical_url) ??
    (apiThreadId ? gmailThreadUrl(apiThreadId, accountIndex) : null);
}

async function defaultEventCollection() {
  const collection = (await getCarnivalMongoDatabase())
    .collection<IncomingEventDocument>(EVENT_COLLECTION);
  globalThis.carnivalIncomingEventIndexPromise ??= Promise.all([
    collection.createIndex(
      { owner_user_id: 1, source: 1, external_event_id: 1 },
      { name: "owner_source_external_event_unique", unique: true },
    ),
    collection.createIndex(
      { owner_user_id: 1, linked_play_id: 1, status: 1, occurred_at: -1 },
      { name: "owner_play_status_occurred" },
    ),
    collection.createIndex(
      { owner_user_id: 1, source: 1, status: 1, occurred_at: -1 },
      { name: "owner_source_status_occurred" },
    ),
  ]);
  await globalThis.carnivalIncomingEventIndexPromise;
  return collection;
}

function gmailRelationshipIds(event: NormalizedIncomingEvent) {
  const values = [
    event.sourceMetadata.inReplyTo,
    event.sourceMetadata.internetMessageId,
    ...(Array.isArray(event.sourceMetadata.references)
      ? event.sourceMetadata.references
      : []),
  ];
  return Array.from(new Set(values.flatMap((value) => text(value) ? [text(value)!] : [])));
}

function gmailCandidateMatchStrategy(
  candidate: GmailCandidate,
  externalThreadId: string | null,
  relationshipIds: string[],
): GmailMatchStrategy {
  const carnivalGoogle = objectValue(candidate.carnival_google);
  const attachment = objectValue(carnivalGoogle?.gmail_attachment);
  if (externalThreadId && text(carnivalGoogle?.gmail_api_thread_id) === externalThreadId) {
    return "api_thread_canonical";
  }
  if (externalThreadId && text(attachment?.api_thread_id) === externalThreadId) {
    return "api_thread_attachment";
  }
  if (externalThreadId && text(candidate.thread_id) === externalThreadId) {
    return "legacy_thread_id";
  }
  if (
    relationshipIds.includes(text(candidate.last_id) ?? "") ||
    relationshipIds.includes(text(candidate.message_id) ?? "")
  ) {
    return "legacy_message_id";
  }
  return "none";
}

export function selectGmailMatchCandidates(
  candidates: GmailCandidate[],
  externalThreadId: string | null,
  relationshipIds: string[],
) {
  if (!externalThreadId) return candidates;
  const apiThreadMatches = candidates.filter((candidate) => {
    const strategy = gmailCandidateMatchStrategy(candidate, externalThreadId, relationshipIds);
    return strategy === "api_thread_canonical" || strategy === "api_thread_attachment";
  });
  return apiThreadMatches.length ? apiThreadMatches : candidates;
}

export class MongoIncomingEventService implements IncomingEventMatchEngine, IncomingEventStore {
  async match(event: NormalizedIncomingEvent): Promise<IncomingEventMatch> {
    assertMongoUserMapping(event.ownerUserId);
    if (event.source !== "gmail") return { status: "unmatched" };
    const externalThreadId = text(event.externalThreadId);
    const relationshipIds = gmailRelationshipIds(event);
    await recordGmailDiagnostic({
      apiThreadPresent: Boolean(externalThreadId),
      matchStrategy: "none",
      ownerUserId: event.ownerUserId,
      reason: externalThreadId ? "api_thread_present" : "relationship_ids_only",
      stage: "GMAIL_MATCH_ATTEMPTED",
      threadId: externalThreadId,
    });
    const relationships: Filter<LegacyTaskDocument>[] = [];
    if (externalThreadId) {
      relationships.push(
        { thread_id: externalThreadId },
        { "carnival_google.gmail_api_thread_id": externalThreadId },
        { "carnival_google.gmail_attachment.api_thread_id": externalThreadId },
      );
    }
    if (relationshipIds.length) {
      relationships.push(
        { last_id: { $in: relationshipIds } },
        { message_id: { $in: relationshipIds } },
      );
    }
    if (!relationships.length) {
      await recordGmailDiagnostic({
        apiThreadPresent: false,
        matchResult: "unmatched",
        matchStrategy: "none",
        ownerUserId: event.ownerUserId,
        reason: "no_relationship_identifiers",
        stage: "GMAIL_MATCH_RESULT",
      });
      return { status: "unmatched" };
    }
    const candidates = await (await getCarnivalMongoDatabase())
      .collection<LegacyTaskDocument>("tasks_task")
      .find({
        ...mongoActiveFilter(),
        task_type: { $ne: "A" },
        $or: relationships,
      }, {
        projection: {
          carnival_google: 1,
          carnival_incoming: 1,
          last_id: 1,
          message_id: 1,
          task_date: 1,
          task_type: 1,
          thread_id: 1,
        },
      })
      .toArray() as GmailCandidate[];
    const tasks = selectGmailMatchCandidates(candidates, externalThreadId, relationshipIds);
    if (tasks.length === 0) {
      await recordGmailDiagnostic({
        apiThreadPresent: Boolean(externalThreadId),
        matchResult: "unmatched",
        matchStrategy: "none",
        ownerUserId: event.ownerUserId,
        reason: "no_candidate",
        stage: "GMAIL_MATCH_RESULT",
        threadId: externalThreadId,
      });
      return { status: "unmatched" };
    }
    const matchStrategy = gmailCandidateMatchStrategy(tasks[0], externalThreadId, relationshipIds);
    if (tasks.length > 1 && !matchStrategy.startsWith("api_thread_")) {
      await recordGmailDiagnostic({
        apiThreadPresent: Boolean(externalThreadId),
        matchResult: "ambiguous",
        matchStrategy,
        matchedPlayCount: tasks.length,
        matchedPlayIds: tasks.map((task) => task._id.toHexString()),
        ownerUserId: event.ownerUserId,
        reason: "multiple_legacy_candidates",
        stage: "GMAIL_MATCH_RESULT",
        threadId: externalThreadId,
      });
      return { candidateCount: tasks.length, status: "ambiguous" };
    }
    const matches = tasks.map((task) => ({
      playId: task._id.toHexString(),
      routingUrl: accountIndexAndUrl(task, externalThreadId),
    }));
    await recordGmailDiagnostic({
      apiThreadPresent: Boolean(externalThreadId),
      matchResult: "matched",
      matchStrategy,
      matchedPlayCount: matches.length,
      matchedPlayIds: matches.map(({ playId }) => playId),
      ownerUserId: event.ownerUserId,
      playId: matches[0].playId,
      reason: matches.length > 1 ? "multiple_intentional_matches" : "candidate_found",
      stage: "GMAIL_MATCH_RESULT",
      threadId: externalThreadId,
    });
    return { matches, status: "matched" };
  }

  async record(
    event: NormalizedIncomingEvent,
    match: IncomingEventMatch,
    mutation: IncomingEventPolicyMutation[] | null,
  ): Promise<IncomingEventProcessResult> {
    const events = await defaultEventCollection();
    const client = await getCarnivalMongoClient();
    const session = client.startSession();
    let mutatedPlayCount = 0;
    let resultPriority: string | null = null;
    try {
      await session.withTransaction(async () => {
        const eventId = new ObjectId();
        await events.insertOne({
          _id: eventId,
          actor: event.actor ?? null,
          event_type: event.eventType,
          external_event_id: event.externalEventId,
          external_item_id: event.externalItemId,
          external_thread_id: event.externalThreadId,
          handled_at: null,
          linked_play_id: match.status === "matched" ? match.matches[0]?.playId ?? null : null,
          linked_play_ids: match.status === "matched"
            ? match.matches.map(({ playId }) => playId)
            : [],
          match_status: match.status,
          occurred_at: new Date(event.occurredAt),
          owner_user_id: event.ownerUserId,
          received_at: new Date(event.receivedAt),
          routing_url: match.status === "matched" ? match.matches[0]?.routingUrl ?? null : null,
          source: event.source,
          source_metadata: event.sourceMetadata,
          status: "unhandled",
        }, { session });
        console.info("CARNIVAL_INCOMING_EVENT EVENT_CREATED", {
          eventId: eventId.toHexString(),
          source: event.source,
        });
        if (!mutation?.length || match.status !== "matched") return;
        const objectIds = mutation.map(({ playId }) => ObjectId.isValid(playId)
          ? new ObjectId(playId)
          : null);
        if (objectIds.some((id) => !id)) throw new Error("matched_play_identifier_invalid");
        const matchedObjectIds = objectIds as ObjectId[];
        const tasks = (await getCarnivalMongoDatabase())
          .collection<LegacyTaskDocument>("tasks_task");
        const currentPlays = await tasks.find({
          ...mongoActiveFilter(),
          _id: { $in: matchedObjectIds },
          task_type: { $ne: "A" },
        }, {
          projection: { carnival_incoming: 1, priority_index: 1, task_date: 1 },
          session,
        }).toArray();
        if (currentPlays.length !== mutation.length) throw new Error("matched_play_no_longer_active");
        const currentById = new Map(currentPlays.map((play) => [play._id.toHexString(), play]));
        const today = new Date(`${mutation[0].scheduledDate}T00:00:00.000Z`);
        const tomorrow = new Date(today);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const existingHeadlines = await tasks.find({
          ...mongoActiveFilter(),
          _id: { $nin: matchedObjectIds },
          task_date: { $gte: today, $lt: tomorrow },
          task_type: { $nin: ["A", "S"] },
        }, { session }).sort({ priority_index: 1, created_date: 1, _id: 1 }).toArray();
        const orderById = new Map(incomingHeadlineGroupOrderUpdates({
          existingHeadlines: existingHeadlines.map((task, index) => ({
            id: task._id.toHexString(),
            order: legacyPriorityNumber(task.priority_index, (index + 1) * 0x100),
          })),
          incomingPlays: mutation.map(({ playId }, index) => ({
            id: playId,
            order: legacyPriorityNumber(
              currentById.get(playId)?.priority_index,
              10 * 0x100000000 + (index + 1) * 0x100,
            ),
          })),
        }).map((item) => [item.id, legacyPriorityValue(item.order)]));
        const updatedAt = new Date();
        const operations = [
          ...existingHeadlines.flatMap((task) => {
            const priorityIndex = orderById.get(task._id.toHexString());
            return priorityIndex && priorityIndex !== task.priority_index
              ? [{
                  updateOne: {
                    filter: {
                      ...mongoActiveFilter(),
                      _id: task._id,
                      task_date: { $gte: today, $lt: tomorrow },
                      task_type: { $nin: ["A", "S"] },
                    },
                    update: { $set: { priority_index: priorityIndex, updated_date: updatedAt } },
                  },
                }]
              : [];
          }),
          ...mutation.map(({ playId }) => {
            const current = currentById.get(playId)!;
            const currentIncoming = objectValue(current.carnival_incoming);
            const existingCount = typeof currentIncoming?.gmail_unhandled_count === "number"
              ? currentIncoming.gmail_unhandled_count
              : 0;
            const routingUrl = match.matches.find((item) => item.playId === playId)?.routingUrl ?? null;
            return {
              updateOne: {
                filter: {
                  ...mongoActiveFilter(),
                  _id: current._id,
                  task_type: { $ne: "A" },
                },
                update: {
                  $set: {
                    "carnival_google.gmail_api_thread_id": event.externalThreadId,
                    "carnival_incoming.gmail_latest_event_id": eventId.toHexString(),
                    "carnival_incoming.gmail_latest_message_id": event.externalItemId,
                    "carnival_incoming.gmail_latest_thread_id": event.externalThreadId,
                    "carnival_incoming.gmail_latest_url": routingUrl,
                    "carnival_incoming.gmail_unhandled_count": existingCount + 1,
                    "carnival_incoming.priority": true,
                    priority_index: orderById.get(playId),
                    task_date: today,
                    task_type: "H",
                    updated_date: updatedAt,
                  },
                },
              },
            };
          }),
        ];
        const update = await tasks.bulkWrite(operations, { session });
        if (update.matchedCount !== operations.length) {
          throw new Error("matched_play_update_failed");
        }
        mutatedPlayCount = mutation.length;
        resultPriority = orderById.get(mutation[0].playId) ?? null;
        for (const { playId, scheduledDate } of mutation) {
          const current = currentById.get(playId)!;
          const currentIncoming = objectValue(current.carnival_incoming);
          const existingCount = typeof currentIncoming?.gmail_unhandled_count === "number"
            ? currentIncoming.gmail_unhandled_count
            : 0;
          const wasToday = current.task_date instanceof Date &&
            current.task_date.toISOString().slice(0, 10) === scheduledDate;
          console.info(
            `CARNIVAL_INCOMING_EVENT ${wasToday ? "PLAY_ALREADY_TODAY" : "PLAY_PROMOTED"}`,
            { playId },
          );
          console.info("CARNIVAL_INCOMING_EVENT GMAIL_INDICATOR_SET", {
            count: existingCount + 1,
            playId,
          });
        }
      });
      const matchedPlayIds = match.status === "matched"
        ? match.matches.map(({ playId }) => playId)
        : [];
      await recordGmailDiagnostic({
        matchedPlayCount: matchedPlayIds.length,
        matchedPlayIds,
        mutationAttempted: Boolean(mutation?.length && match.status === "matched"),
        ownerUserId: event.ownerUserId,
        playId: matchedPlayIds[0] ?? null,
        reason: mutatedPlayCount ? "mutation_complete" : "not_matched",
        resultDate: mutatedPlayCount ? mutation?.[0]?.scheduledDate : null,
        resultPriority,
        resultTaskType: mutatedPlayCount ? "H" : null,
        stage: "PLAY_INCOMING_MUTATION",
        threadId: event.externalThreadId,
      });
      return {
        duplicate: false,
        linkedPlayId: matchedPlayIds[0] ?? null,
        linkedPlayIds: matchedPlayIds,
        matchStatus: match.status,
        mutatedPlay: mutatedPlayCount > 0,
      };
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        console.info("CARNIVAL_INCOMING_EVENT EVENT_DUPLICATE", {
          externalEventId: event.externalEventId,
          source: event.source,
        });
        await recordGmailDiagnostic({
          mutationAttempted: false,
          ownerUserId: event.ownerUserId,
          playId: match.status === "matched" ? match.matches[0]?.playId ?? null : null,
          reason: "duplicate_event",
          stage: "PLAY_INCOMING_MUTATION",
          threadId: event.externalThreadId,
        });
        return {
          duplicate: true,
          linkedPlayId: match.status === "matched" ? match.matches[0]?.playId ?? null : null,
          linkedPlayIds: match.status === "matched"
            ? match.matches.map(({ playId }) => playId)
            : [],
          matchStatus: match.status,
          mutatedPlay: false,
        };
      }
      await recordGmailDiagnostic({
        mutationAttempted: Boolean(mutation?.length && match.status === "matched"),
        ownerUserId: event.ownerUserId,
        playId: match.status === "matched" ? match.matches[0]?.playId ?? null : null,
        reason: "mutation_failed",
        stage: "PLAY_INCOMING_MUTATION",
        threadId: event.externalThreadId,
      });
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async handleAllForPlay(ownerUserId: string, playId: string) {
    assertMongoUserMapping(ownerUserId);
    if (!ObjectId.isValid(playId)) return false;
    const events = await defaultEventCollection();
    const client = await getCarnivalMongoClient();
    const session = client.startSession();
    let handled = false;
    try {
      await session.withTransaction(async () => {
        const pending = await events.find({
          owner_user_id: ownerUserId,
          source: "gmail",
          status: "unhandled",
          $or: [{ linked_play_id: playId }, { linked_play_ids: playId }],
        }, { projection: { linked_play_id: 1, linked_play_ids: 1 }, session }).toArray();
        if (!pending.length) return;
        const linkedPlayIds = Array.from(new Set(pending.flatMap((item) => [
          ...(item.linked_play_ids ?? []),
          ...(item.linked_play_id ? [item.linked_play_id] : []),
        ])));
        const result = await events.updateMany({
          _id: { $in: pending.flatMap(({ _id }) => _id ? [_id] : []) },
          owner_user_id: ownerUserId,
          status: "unhandled",
        }, { $set: { handled_at: new Date(), status: "handled" } }, { session });
        if (result.modifiedCount === 0) return;
        const tasks = (await getCarnivalMongoDatabase())
          .collection<LegacyTaskDocument>("tasks_task");
        await tasks.updateMany({
          ...mongoActiveFilter(),
          _id: { $in: linkedPlayIds.filter(ObjectId.isValid).map((id) => new ObjectId(id)) },
        }, {
          $unset: { carnival_incoming: "" },
          $set: { updated_date: new Date() },
        }, { session });
        handled = true;
      });
      if (handled) console.info("CARNIVAL_INCOMING_EVENT EVENT_HANDLED", { playId });
      return handled;
    } finally {
      await session.endSession();
    }
  }
}

export const INCOMING_EVENT_COLLECTION = EVENT_COLLECTION;
