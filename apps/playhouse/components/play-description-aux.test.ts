import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlayListItem } from "../domain/play";
import {
  createDescriptionClickController,
  routePlayDescriptionAux,
} from "./play-description-aux";

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

afterEach(() => vi.useRealTimers());

describe("Play Description Aux routing", () => {
  it.each([
    {
      expected: ["url:https://example.com"],
      slackUrl: null,
      value: play({ url: "https://example.com" }),
    },
    {
      expected: ["slack:https://app.slack.com/client/T1/C1"],
      slackUrl: "https://app.slack.com/client/T1/C1",
      value: play(),
    },
    {
      expected: ["url:https://mail.google.com/mail/u/0/#all/FM1"],
      slackUrl: null,
      value: play({ gmailThreadId: "FM1" }),
    },
    {
      expected: ["url:https://example.com", "slack:https://app.slack.com/client/T1/C1"],
      slackUrl: "https://app.slack.com/client/T1/C1",
      value: play({ url: "https://example.com" }),
    },
    {
      expected: [
        "slack:https://app.slack.com/client/T1/C1",
        "url:https://mail.google.com/mail/u/0/#all/FM1",
      ],
      slackUrl: "https://app.slack.com/client/T1/C1",
      value: play({ gmailThreadId: "FM1" }),
    },
    {
      expected: [
        "url:https://example.com",
        "url:https://mail.google.com/mail/u/0/#all/FM1",
      ],
      slackUrl: null,
      value: play({ gmailThreadId: "FM1", url: "https://example.com" }),
    },
    {
      expected: [
        "url:https://example.com",
        "slack:https://app.slack.com/client/T1/C1",
        "url:https://mail.google.com/mail/u/0/#all/FM1",
      ],
      slackUrl: "https://app.slack.com/client/T1/C1",
      value: play({ gmailThreadId: "FM1", url: "https://example.com" }),
    },
    { expected: [], slackUrl: null, value: play() },
  ])("routes only available destinations in URL, Slack, Gmail order", async ({
    expected,
    slackUrl,
    value,
  }) => {
    const events: string[] = [];
    await routePlayDescriptionAux(
      value,
      slackUrl,
      async (url) => { events.push(`url:${url}`); },
      async (url) => { events.push(`slack:${url}`); },
    );
    expect(events).toEqual(expected);
  });

  it("continues through later destinations after an earlier route fails", async () => {
    const events: string[] = [];
    await routePlayDescriptionAux(
      play({ gmailThreadId: "FM1", url: "https://example.com" }),
      "https://app.slack.com/client/T1/C1",
      async (url) => {
        events.push(url);
        if (url === "https://example.com") throw new Error("Misc unavailable");
      },
      async (url) => { events.push(url); },
    );
    expect(events).toEqual([
      "https://example.com",
      "https://app.slack.com/client/T1/C1",
      "https://mail.google.com/mail/u/0/#all/FM1",
    ]);
  });
});

describe("Description click timing", () => {
  it("routes once after the short single-click delay without opening detail", async () => {
    vi.useFakeTimers();
    const openDetails = vi.fn();
    const routeLinks = vi.fn(async () => undefined);
    const controller = createDescriptionClickController();

    controller.singleClick(1, routeLinks);
    expect(openDetails).not.toHaveBeenCalled();
    expect(routeLinks).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(225);
    expect(routeLinks).toHaveBeenCalledOnce();
    expect(openDetails).not.toHaveBeenCalled();
  });

  it("cancels single-click routing when the click becomes a double-click", async () => {
    vi.useFakeTimers();
    const openDetails = vi.fn();
    const routeLinks = vi.fn(async () => undefined);
    const controller = createDescriptionClickController();

    controller.singleClick(1, routeLinks);
    controller.singleClick(2, routeLinks);
    controller.doubleClick(openDetails);
    await vi.runAllTimersAsync();
    expect(openDetails).toHaveBeenCalledOnce();
    expect(routeLinks).not.toHaveBeenCalled();
  });
});
