import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type {
  IncomingEventMatch,
  IncomingEventPolicyMutation,
  NormalizedIncomingEvent,
} from "./incoming-event";
import {
  incomingCommunicationPolicy,
  incomingHeadlineOrderUpdates,
  processIncomingEvent,
} from "./incoming-event";

function event(source: NormalizedIncomingEvent["source"] = "slack"): NormalizedIncomingEvent {
  return {
    eventType: "communication_received",
    externalEventId: "event-1",
    externalItemId: "item-1",
    externalThreadId: "thread-1",
    occurredAt: "2026-09-16T12:00:00.000Z",
    ownerUserId: "owner-1",
    receivedAt: "2026-09-16T12:00:01.000Z",
    source,
    sourceMetadata: {},
  };
}

describe("Carnival Incoming Events core", () => {
  it("moves a matched event to Today as a Headline regardless of its prior placement or rank", async () => {
    const match: IncomingEventMatch = {
      playId: "play-1",
      routingUrl: "https://example.com/thread-1",
      status: "matched",
    };
    const matchEngine = { match: vi.fn().mockResolvedValue(match) };
    const record = vi.fn(async (
      _event: NormalizedIncomingEvent,
      storedMatch: IncomingEventMatch,
      mutation: IncomingEventPolicyMutation | null,
    ) => ({
      duplicate: false,
      linkedPlayId: storedMatch.status === "matched" ? storedMatch.playId : null,
      matchStatus: storedMatch.status,
      mutatedPlay: Boolean(mutation),
    }));

    const result = await processIncomingEvent({
      event: event(),
      matchEngine,
      store: { record },
      todayDate: "2026-09-16",
    });

    expect(record).toHaveBeenCalledWith(event(), match, {
      incomingPriority: true,
      placeAtTop: true,
      playId: "play-1",
      playType: "normal",
      scheduledDate: "2026-09-16",
    });
    expect(result).toMatchObject({ linkedPlayId: "play-1", mutatedPlay: true });
  });

  it.each([
    { status: "unmatched" } as const,
    { candidateCount: 2, status: "ambiguous" } as const,
  ])("never creates a Play or requests mutation for $status events", async (match) => {
    const record = vi.fn().mockResolvedValue({
      duplicate: false,
      linkedPlayId: null,
      matchStatus: match.status,
      mutatedPlay: false,
    });
    await processIncomingEvent({
      event: event("calendar"),
      matchEngine: { match: vi.fn().mockResolvedValue(match) },
      store: { record },
      todayDate: "2026-09-16",
    });
    expect(record.mock.calls[0]?.[2]).toBeNull();
  });

  it("has no policy mutation when no existing Play is matched", () => {
    expect(incomingCommunicationPolicy({ status: "unmatched" }, "2026-09-16")).toBeNull();
  });

  it("places a matched Play at the absolute top of today's Headlines", () => {
    expect(incomingHeadlineOrderUpdates({
      existingHeadlines: [
        { id: "headline-2", order: 10 * 0x100000000 + 0x300 },
        { id: "headline-1", order: 10 * 0x100000000 + 0x200 },
      ],
      incomingPlay: { id: "incoming", order: 10 * 0x100000000 + 0x900 },
    })).toEqual([{
      id: "incoming",
      order: 10 * 0x100000000 + 0x100,
    }]);
  });

  it("rebalances Headlines without changing their relative order when no gap exists", () => {
    expect(incomingHeadlineOrderUpdates({
      existingHeadlines: [
        { id: "headline-1", order: 10 * 0x100000000 },
        { id: "headline-2", order: 10 * 0x100000000 + 1 },
      ],
      incomingPlay: { id: "incoming", order: 10 * 0x100000000 + 0x900 },
    })).toEqual([
      { id: "incoming", order: 10 * 0x100000000 + 0x100 },
      { id: "headline-1", order: 10 * 0x100000000 + 0x200 },
      { id: "headline-2", order: 10 * 0x100000000 + 0x300 },
    ]);
  });

  it("keeps Play creation APIs out of the Incoming Events processor and store", () => {
    const core = readFileSync(new URL("./incoming-event.ts", import.meta.url), "utf8");
    const store = readFileSync(
      new URL("../lib/incoming-events/mongo-incoming-event-store.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of ["createGmail", "createPlay", "mongoCreateDocument", "tasks.insertOne"]) {
      expect(`${core}\n${store}`).not.toContain(forbidden);
    }
    expect(store).toContain('"carnival_incoming.gmail_unhandled_count": existingCount + 1');
    expect(store).toContain("priority_index: orderById.get(mutation.playId)");
    expect(store).toContain("task_date: today");
    expect(store).toContain('task_type: "H"');
    expect(store).toContain('{ "carnival_google.gmail_api_thread_id": externalThreadId }');
    expect(store).toContain('{ "carnival_google.gmail_attachment.api_thread_id": externalThreadId }');
  });
});
