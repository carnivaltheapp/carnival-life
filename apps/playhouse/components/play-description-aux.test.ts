import { describe, expect, it, vi } from "vitest";

import type { PlayListItem } from "../domain/play";
import { openPlayDetailsAndRouteAux } from "./play-description-aux";

function play(overrides: Partial<PlayListItem> = {}): PlayListItem {
  return {
    basketId: null,
    branch: null,
    durationMinutes: 30,
    id: "play-1",
    nextPlayId: null,
    note: null,
    place: "Office",
    playerContactId: null,
    playerDisplayName: null,
    playType: "normal",
    pushRule: "everyday",
    scheduledDate: "2026-09-14",
    sourceType: "user",
    title: "Review",
    url: null,
    ...overrides,
  };
}

describe("Play Description Aux routing", () => {
  it("opens detail, routes URL, and routes Gmail last", async () => {
    const events: string[] = [];
    await openPlayDetailsAndRouteAux(
      play({
        gmailAccountIndex: 2,
        gmailThreadId: "FMexact",
        url: "https://example.com/context",
      }),
      () => events.push("detail"),
      async (url) => { events.push(url); },
    );

    expect(events).toEqual([
      "detail",
      "https://example.com/context",
      "https://mail.google.com/mail/u/2/#all/FMexact",
    ]);
  });

  it.each([
    {
      expected: ["detail"],
      value: play({ playerContactId: "slack-player", playerDisplayName: "Ada" }),
    },
    {
      expected: ["detail", "https://example.com/context"],
      value: play({
        playerContactId: "slack-player",
        playerDisplayName: "Ada",
        url: "https://example.com/context",
      }),
    },
    {
      expected: ["detail", "https://mail.google.com/mail/u/0/#all/FMexact"],
      value: play({
        gmailThreadId: "FMexact",
        playerContactId: "slack-player",
        playerDisplayName: "Ada",
      }),
    },
  ])("never routes Slack from Description", async ({ expected, value }) => {
    const events: string[] = [];
    await openPlayDetailsAndRouteAux(
      value,
      () => events.push("detail"),
      async (url) => { events.push(url); },
    );
    expect(events).toEqual(expected);
  });

  it.each([
    {
      expected: ["detail", "https://mail.google.com/mail/u/1/#all/FMonly"],
      value: play({ gmailAccountIndex: 1, gmailThreadId: "FMonly" }),
    },
    {
      expected: ["detail", "https://example.com/only"],
      value: play({ url: "https://example.com/only" }),
    },
    { expected: ["detail"], value: play() },
  ])("routes only available destinations", async ({ expected, value }) => {
    const events: string[] = [];
    await openPlayDetailsAndRouteAux(
      value,
      () => events.push("detail"),
      async (url) => { events.push(url); },
    );
    expect(events).toEqual(expected);
  });

  it("keeps detail open and still attempts Gmail when URL routing fails", async () => {
    const openDetails = vi.fn();
    const route = vi.fn(async (url: string) => {
      if (url.includes("example.com")) throw new Error("Misc unavailable");
    });
    await expect(openPlayDetailsAndRouteAux(
      play({ gmailThreadId: "FMexact", url: "https://example.com/fail" }),
      openDetails,
      route,
    )).resolves.toBeUndefined();

    expect(openDetails).toHaveBeenCalledOnce();
    expect(route.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/fail",
      "https://mail.google.com/mail/u/0/#all/FMexact",
    ]);
  });
});
