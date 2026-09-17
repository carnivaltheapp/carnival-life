import { ObjectId } from "mongodb";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GMAIL_DIAGNOSTIC_STAGES,
  gmailDiagnosticDocument,
  gmailThreadFingerprint,
  MongoGmailDiagnosticRepository,
} from "./gmail-diagnostics";

describe("Gmail pipeline diagnostics", () => {
  it("defines and instruments the complete Gmail lifecycle trail", () => {
    expect(GMAIL_DIAGNOSTIC_STAGES).toEqual([
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
    ]);
    const sources = [
      readFileSync(new URL("../../app/plays/actions.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./gmail-watch.server.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./mongo-incoming-event-store.ts", import.meta.url), "utf8"),
    ].join("\n");
    for (const stage of GMAIL_DIAGNOSTIC_STAGES) expect(sources).toContain(stage);
  });

  it("records outgoing lifecycle results without raw Gmail identifiers", () => {
    const document = gmailDiagnosticDocument({
      apiThreadPresent: true,
      operation: "unstar",
      ownerUserId: "owner-1",
      playId: "play-1",
      reason: "matching_tab_not_found",
      stage: "GMAIL_OUTGOING_SYNC_RESULT",
      success: false,
      webThreadPresent: true,
    });
    expect(document).toMatchObject({
      api_thread_present: true,
      operation: "unstar",
      play_id: "play-1",
      reason: "matching_tab_not_found",
      stage: "GMAIL_OUTGOING_SYNC_RESULT",
      success: false,
      web_thread_present: true,
    });
    expect(document).not.toHaveProperty("thread_fingerprint");
  });

  it("creates a safe stage record with only a thread fingerprint", () => {
    const rawThreadId = "api-thread-sensitive";
    const document = gmailDiagnosticDocument({
      apiThreadPresent: true,
      correlationId: "drop-1",
      extractionStrategy: "conversation_header",
      ownerUserId: "owner-1",
      playId: "play-1",
      reason: "persisted",
      source: "list_row",
      stage: "PLAY_GMAIL_LINK_PERSISTED",
      threadId: rawThreadId,
      webThreadPresent: true,
      ...({
        authorization: "secret",
        emailAddress: "private@example.com",
        messageBody: "private body",
        subject: "private subject",
      } as object),
    }, new Date("2026-09-17T03:00:00.000Z"));

    expect(document).toEqual({
      api_thread_present: true,
      correlation_id: "drop-1",
      created_at: new Date("2026-09-17T03:00:00.000Z"),
      extraction_strategy: "conversation_header",
      identifier_type: "gmail_api_thread_id",
      owner_user_id: "owner-1",
      play_id: "play-1",
      reason: "persisted",
      source: "list_row",
      stage: "PLAY_GMAIL_LINK_PERSISTED",
      thread_fingerprint: gmailThreadFingerprint(rawThreadId),
      web_thread_present: true,
    });
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain(rawThreadId);
    for (const forbidden of ["authorization", "emailAddress", "messageBody", "subject"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("records stages and returns the latest trail in chronological order", async () => {
    const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const toArray = vi.fn().mockResolvedValue([
      {
        _id: new ObjectId("68cb70000000000000000002"),
        created_at: new Date("2026-09-17T03:00:02.000Z"),
        owner_user_id: "owner-1",
        stage: "GMAIL_MATCH_RESULT",
      },
      {
        _id: new ObjectId("68cb70000000000000000001"),
        created_at: new Date("2026-09-17T03:00:01.000Z"),
        owner_user_id: "owner-1",
        stage: "GMAIL_MATCH_ATTEMPTED",
      },
    ]);
    const limit = vi.fn().mockReturnValue({ toArray });
    const sort = vi.fn().mockReturnValue({ limit });
    const find = vi.fn().mockReturnValue({ sort });
    const repository = new MongoGmailDiagnosticRepository(async () => ({
      find,
      insertOne,
    }) as never);

    await repository.record({
      ownerUserId: "owner-1",
      stage: "DRAG_METADATA_RECEIVED",
    }, new Date("2026-09-17T03:00:00.000Z"));
    const result = await repository.list({
      limit: 25,
      ownerUserId: "owner-1",
      playId: "play-1",
      reason: "mutation_complete",
      stage: "PLAY_INCOMING_MUTATION",
      threadFingerprint: "a".repeat(64),
    });

    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
      owner_user_id: "owner-1",
      stage: "DRAG_METADATA_RECEIVED",
    }));
    expect(find).toHaveBeenCalledWith({
      owner_user_id: "owner-1",
      play_id: "play-1",
      reason: "mutation_complete",
      stage: "PLAY_INCOMING_MUTATION",
      thread_fingerprint: "a".repeat(64),
    }, { projection: { owner_user_id: 0 } });
    expect(sort).toHaveBeenCalledWith({ created_at: -1, _id: -1 });
    expect(limit).toHaveBeenCalledWith(25);
    expect(result.map(({ stage }) => stage)).toEqual([
      "GMAIL_MATCH_ATTEMPTED",
      "GMAIL_MATCH_RESULT",
    ]);
    expect(result.every((entry) => !("owner_user_id" in entry))).toBe(true);
  });

  it("keeps the JSON retrieval route authenticated and owner-scoped", () => {
    const route = readFileSync(
      new URL("../../app/api/diagnostics/gmail/route.ts", import.meta.url),
      "utf8",
    );
    expect(route).toContain("supabase.auth.getClaims()");
    expect(route).toContain('error: "unauthorized"');
    expect(route).toContain("ownerUserId,");
    expect(route).toContain('"Cache-Control": "private, no-store"');
    expect(route.indexOf("getClaims()")).toBeLessThan(route.indexOf(".list({"));
  });
});
