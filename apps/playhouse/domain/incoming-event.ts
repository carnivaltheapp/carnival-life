export const INCOMING_EVENT_SOURCES = [
  "gmail",
  "calendar",
  "slack",
  "jira",
  "sms",
  "carnival",
] as const;

export type IncomingEventSource = (typeof INCOMING_EVENT_SOURCES)[number];

export type IncomingActor = {
  email?: string;
  externalId?: string;
  name?: string;
};

export type NormalizedIncomingEvent = {
  actor?: IncomingActor;
  eventType: string;
  externalEventId: string;
  externalItemId: string | null;
  externalThreadId: string | null;
  occurredAt: string;
  ownerUserId: string;
  receivedAt: string;
  source: IncomingEventSource;
  sourceMetadata: Record<string, unknown>;
};

export type IncomingEventMatch =
  | { status: "ambiguous"; candidateCount: number }
  | { status: "matched"; playId: string; routingUrl: string | null }
  | { status: "unmatched" };

export type IncomingEventPolicyMutation = {
  incomingPriority: true;
  playId: string;
  playType: "reminder";
  scheduledDate: string;
};

export type IncomingEventProcessResult = {
  duplicate: boolean;
  linkedPlayId: string | null;
  matchStatus: IncomingEventMatch["status"];
  mutatedPlay: boolean;
};

export interface IncomingEventMatchEngine {
  match(event: NormalizedIncomingEvent): Promise<IncomingEventMatch>;
}

export interface IncomingEventStore {
  record(
    event: NormalizedIncomingEvent,
    match: IncomingEventMatch,
    mutation: IncomingEventPolicyMutation | null,
  ): Promise<IncomingEventProcessResult>;
}

export function incomingCommunicationPolicy(
  match: IncomingEventMatch,
  todayDate: string,
): IncomingEventPolicyMutation | null {
  return match.status === "matched"
    ? {
        incomingPriority: true,
        playId: match.playId,
        playType: "reminder",
        scheduledDate: todayDate,
      }
    : null;
}

export async function processIncomingEvent({
  event,
  matchEngine,
  store,
  todayDate,
}: {
  event: NormalizedIncomingEvent;
  matchEngine: IncomingEventMatchEngine;
  store: IncomingEventStore;
  todayDate: string;
}) {
  console.info("CARNIVAL_INCOMING_EVENT MATCH_START", {
    externalEventId: event.externalEventId,
    source: event.source,
  });
  const match = await matchEngine.match(event);
  if (match.status === "matched") {
    console.info("CARNIVAL_INCOMING_EVENT MATCHED", { playId: match.playId, source: event.source });
  } else if (match.status === "ambiguous") {
    console.warn("CARNIVAL_INCOMING_EVENT AMBIGUOUS", {
      candidateCount: match.candidateCount,
      source: event.source,
    });
  } else {
    console.info("CARNIVAL_INCOMING_EVENT UNMATCHED", { source: event.source });
  }
  return store.record(
    event,
    match,
    incomingCommunicationPolicy(match, todayDate),
  );
}
