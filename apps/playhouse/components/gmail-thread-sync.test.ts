import { afterEach, describe, expect, it, vi } from "vitest";

const { recordGmailOutgoingSync } = vi.hoisted(() => ({
  recordGmailOutgoingSync: vi.fn().mockResolvedValue({ status: "success" }),
}));
vi.mock("../app/plays/actions", () => ({ recordGmailOutgoingSync }));

import type { PlayListItem } from "../domain/play";
import { requestGmailThreadUnstar } from "./gmail-thread-sync";

const play: PlayListItem = {
  basketId: null,
  branch: null,
  durationMinutes: 30,
  gmailAccountIndex: 2,
  gmailApiThreadId: "1a0ad6003af12a6b",
  gmailThreadId: "1a0ad6003af12a6b",
  gmailWebThreadRef: "FMexact",
  id: "play-1",
  nextPlayId: null,
  note: null,
  place: "Office",
  playerContactId: null,
  playerDisplayName: null,
  playType: "normal",
  pushRule: "everyday",
  scheduledDate: "2026-09-14",
  sourceType: "gmail",
  title: "Gmail Play",
  url: null,
};

afterEach(() => {
  recordGmailOutgoingSync.mockClear();
  vi.unstubAllGlobals();
});

describe("Gmail lifecycle browser sync", () => {
  it.each(["done", "trash"] as const)(
    "requests one exact-thread unstar after %s without mutating the Play",
    (action) => {
      const events: Event[] = [];
      vi.stubGlobal("window", { dispatchEvent: (event: Event) => events.push(event) });
      vi.stubGlobal("crypto", { randomUUID: () => "correlation-1" });

      expect(requestGmailThreadUnstar(play, action)).toBe(true);
      expect(events).toHaveLength(1);
      expect(JSON.parse((events[0] as CustomEvent<string>).detail)).toEqual({
        accountIndex: 2,
        action,
        apiThreadIdPresent: true,
        correlationId: "correlation-1",
        playId: "play-1",
        threadRef: "FMexact",
        webThreadRefPresent: true,
      });
      expect(recordGmailOutgoingSync).toHaveBeenCalledWith(expect.objectContaining({
        apiThreadIdPresent: true,
        operation: "unstar",
        stage: "GMAIL_OUTGOING_SYNC_REQUESTED",
        webThreadRefPresent: true,
      }));
      expect(play.playType).toBe("normal");
    },
  );

  it("never substitutes the Gmail API thread ID for a missing web reference", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    expect(requestGmailThreadUnstar({ ...play, gmailWebThreadRef: null }, "done")).toBe(false);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as CustomEvent).type)
      .toBe("carnival:gmail-unstar-result");
    expect(JSON.parse((dispatchEvent.mock.calls[0][0] as CustomEvent<string>).detail))
      .toMatchObject({
        diagnosticRecorded: true,
        ok: false,
        reason: "web_thread_ref_missing",
      });
    expect(recordGmailOutgoingSync).toHaveBeenLastCalledWith(expect.objectContaining({
      apiThreadIdPresent: true,
      reason: "web_thread_ref_missing",
      stage: "GMAIL_OUTGOING_SYNC_RESULT",
      success: false,
      webThreadRefPresent: false,
    }));
  });
});
