import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlayListItem } from "../domain/play";
import { requestGmailThreadUnstar } from "./gmail-thread-sync";

const play: PlayListItem = {
  basketId: null,
  branch: null,
  durationMinutes: 30,
  gmailAccountIndex: 2,
  gmailThreadId: "FMexact",
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

afterEach(() => vi.unstubAllGlobals());

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
        correlationId: "correlation-1",
        playId: "play-1",
        threadRef: "FMexact",
      });
      expect(play.playType).toBe("normal");
    },
  );

  it("does not request Gmail sync for an unlinked Play", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    expect(requestGmailThreadUnstar({ ...play, gmailThreadId: null }, "done")).toBe(false);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
