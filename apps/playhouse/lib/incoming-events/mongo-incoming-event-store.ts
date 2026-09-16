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
import { gmailThreadUrl } from "../../domain/play-display";
import {
  getCarnivalMongoClient,
  getCarnivalMongoDatabase,
} from "../playhouse/mongo-client";
import {
  assertMongoUserMapping,
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

export class MongoIncomingEventService implements IncomingEventMatchEngine, IncomingEventStore {
  async match(event: NormalizedIncomingEvent): Promise<IncomingEventMatch> {
    assertMongoUserMapping(event.ownerUserId);
    if (event.source !== "gmail") return { status: "unmatched" };
    const externalThreadId = text(event.externalThreadId);
    const relationshipIds = gmailRelationshipIds(event);
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
    if (!relationships.length) return { status: "unmatched" };
    const tasks = await (await getCarnivalMongoDatabase())
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
      .limit(2)
      .toArray() as GmailCandidate[];
    if (tasks.length === 0) return { status: "unmatched" };
    if (tasks.length > 1) return { candidateCount: tasks.length, status: "ambiguous" };
    const playId = tasks[0]._id.toHexString();
    return {
      playId,
      routingUrl: accountIndexAndUrl(tasks[0], externalThreadId),
      status: "matched",
    };
  }

  async record(
    event: NormalizedIncomingEvent,
    match: IncomingEventMatch,
    mutation: IncomingEventPolicyMutation | null,
  ): Promise<IncomingEventProcessResult> {
    const events = await defaultEventCollection();
    const client = await getCarnivalMongoClient();
    const session = client.startSession();
    let mutatedPlay = false;
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
          linked_play_id: match.status === "matched" ? match.playId : null,
          match_status: match.status,
          occurred_at: new Date(event.occurredAt),
          owner_user_id: event.ownerUserId,
          received_at: new Date(event.receivedAt),
          routing_url: match.status === "matched" ? match.routingUrl : null,
          source: event.source,
          source_metadata: event.sourceMetadata,
          status: "unhandled",
        }, { session });
        console.info("CARNIVAL_INCOMING_EVENT EVENT_CREATED", {
          eventId: eventId.toHexString(),
          source: event.source,
        });
        if (!mutation || match.status !== "matched") return;
        const objectId = ObjectId.isValid(mutation.playId)
          ? new ObjectId(mutation.playId)
          : null;
        if (!objectId) throw new Error("matched_play_identifier_invalid");
        const tasks = (await getCarnivalMongoDatabase())
          .collection<LegacyTaskDocument>("tasks_task");
        const current = await tasks.findOne({
          ...mongoActiveFilter(),
          _id: objectId,
          task_type: { $ne: "A" },
        }, { projection: { carnival_incoming: 1, task_date: 1 }, session });
        if (!current) throw new Error("matched_play_no_longer_active");
        const currentIncoming = objectValue(current.carnival_incoming);
        const existingCount = typeof currentIncoming?.gmail_unhandled_count === "number"
          ? currentIncoming.gmail_unhandled_count
          : 0;
        const update = await tasks.updateOne({
          ...mongoActiveFilter(),
          _id: objectId,
          task_type: { $ne: "A" },
        }, {
          $set: {
            "carnival_google.gmail_api_thread_id": event.externalThreadId,
            "carnival_incoming.gmail_latest_event_id": eventId.toHexString(),
            "carnival_incoming.gmail_latest_message_id": event.externalItemId,
            "carnival_incoming.gmail_latest_thread_id": event.externalThreadId,
            "carnival_incoming.gmail_latest_url": match.routingUrl,
            "carnival_incoming.gmail_unhandled_count": existingCount + 1,
            "carnival_incoming.priority": true,
            task_date: new Date(`${mutation.scheduledDate}T00:00:00.000Z`),
            task_type: "S",
            updated_date: new Date(),
          },
        }, { session });
        if (update.matchedCount !== 1) throw new Error("matched_play_update_failed");
        mutatedPlay = true;
        const wasToday = current.task_date instanceof Date &&
          current.task_date.toISOString().slice(0, 10) === mutation.scheduledDate;
        console.info(
          `CARNIVAL_INCOMING_EVENT ${wasToday ? "PLAY_ALREADY_TODAY" : "PLAY_PROMOTED"}`,
          { playId: mutation.playId },
        );
        console.info("CARNIVAL_INCOMING_EVENT GMAIL_INDICATOR_SET", {
          count: existingCount + 1,
          playId: mutation.playId,
        });
      });
      return {
        duplicate: false,
        linkedPlayId: match.status === "matched" ? match.playId : null,
        matchStatus: match.status,
        mutatedPlay,
      };
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        console.info("CARNIVAL_INCOMING_EVENT EVENT_DUPLICATE", {
          externalEventId: event.externalEventId,
          source: event.source,
        });
        return {
          duplicate: true,
          linkedPlayId: match.status === "matched" ? match.playId : null,
          matchStatus: match.status,
          mutatedPlay: false,
        };
      }
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
        const result = await events.updateMany({
          linked_play_id: playId,
          owner_user_id: ownerUserId,
          source: "gmail",
          status: "unhandled",
        }, { $set: { handled_at: new Date(), status: "handled" } }, { session });
        if (result.modifiedCount === 0) return;
        const tasks = (await getCarnivalMongoDatabase())
          .collection<LegacyTaskDocument>("tasks_task");
        const update = await tasks.updateOne({
          ...mongoActiveFilter(),
          _id: new ObjectId(playId),
        }, {
          $unset: { carnival_incoming: "" },
          $set: { updated_date: new Date() },
        }, { session });
        if (update.matchedCount !== 1) throw new Error("incoming_indicator_clear_failed");
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
