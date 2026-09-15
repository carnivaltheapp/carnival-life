import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/tree-of-life/actions", () => ({
  resolveTreeOfLifeDriveDestination: vi.fn(async () => null),
}));

import type { PlayListItem } from "../domain/play";
import { treeOfLifeRelativePathFromBranch } from "../domain/tree-of-life";
import { runExactDriveBackfill } from "../lib/google/drive-backfill";
import { GoogleDriveHierarchyResolver } from "../lib/google/drive";
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

  it("routes exact Drive identity before URL, Slack, and Gmail", async () => {
    const events: string[] = [];
    await routePlayDescriptionAux(
      play({
        branch: "Blue Field Law\\Automation\\BFLX",
        gmailThreadId: "FM1",
        url: "https://example.com",
      }),
      "https://app.slack.com/client/T1/C1",
      async (url) => { events.push(url); },
      async (url) => { events.push(url); },
      async () => "https://drive.google.com/drive/folders/ABC123",
    );
    expect(events).toEqual([
      "https://drive.google.com/drive/folders/ABC123",
      "https://example.com",
      "https://app.slack.com/client/T1/C1",
      "https://mail.google.com/mail/u/0/#all/FM1",
    ]);
  });

  it("routes the exact hierarchically resolved BFLX folder through the Drive Hot Tab", async () => {
    const destinations: string[] = [];
    const folders = new Map([
      ["root/Blue Field Law", [{ id: "BFL" }]],
      ["BFL/Automation", [{ id: "AUTO" }]],
      ["AUTO/BFLX", [{ id: "BFLX123" }]],
    ]);
    const resolver = new GoogleDriveHierarchyResolver("token", async (input) => {
      const query = new URL(String(input)).searchParams.get("q") ?? "";
      const parent = /'([^']+)' in parents/.exec(query)?.[1];
      const name = /name = '([^']+)'/.exec(query)?.[1];
      return new Response(JSON.stringify({ files: folders.get(`${parent}/${name}`) ?? [] }));
    });
    await routePlayDescriptionAux(
      play({ branch: "Blue Field Law\\Automation\\BFLX" }),
      null,
      async (url) => { destinations.push(url); },
      undefined,
      async (branch) => {
        const result = await resolver.resolve(branch);
        return result.status === "resolved" ? result.folders.at(-1)?.webUrl ?? null : null;
      },
    );
    expect(destinations).toEqual(["https://drive.google.com/drive/folders/BFLX123"]);
  });

  it("backfills, verifies, looks up, and routes a canonical Play Branch end-to-end", async () => {
    const persisted = new Map<string, { folderId: string; webUrl: string }>();
    const request = async (input: string | URL | Request) => {
      const query = new URL(String(input)).searchParams.get("q") ?? "";
      const parent = /'([^']+)' in parents/.exec(query)?.[1];
      const name = /name = '([^']+)'/.exec(query)?.[1];
      const ids = new Map([
        ["root/Blue Field Law", "BFL"],
        ["BFL/Automation", "AUTO"],
        ["AUTO/BFLX", "BFLX123"],
      ]);
      const id = ids.get(`${parent}/${name}`);
      return new Response(JSON.stringify({ files: id ? [{ id }] : [] }));
    };
    const resolver = new GoogleDriveHierarchyResolver("token", request);
    const summary = await runExactDriveBackfill({
      cache: async (folders) => {
        for (const folder of folders) {
          persisted.set(folder.relativePath, { folderId: folder.folderId, webUrl: folder.webUrl });
        }
      },
      readBack: async (paths) => paths.flatMap((relativePath) => {
        const value = persisted.get(relativePath);
        return value ? [{
          driveFolderId: value.folderId,
          driveWebUrl: value.webUrl,
          relativePath,
        }] : [];
      }),
      resolve: (relativePath) => resolver.resolve(relativePath),
      targets: [{
        driveFolderId: null,
        driveWebUrl: null,
        relativePath: "Blue Field Law/Automation/BFLX",
      }],
    });
    expect(summary.resolved).toBe(1);
    expect(persisted.get("Blue Field Law/Automation/BFLX")?.folderId).toBe("BFLX123");

    const destinations: string[] = [];
    await routePlayDescriptionAux(
      play({ branch: "C:\\Google Drive\\Blue Field Law\\Automation\\BFLX" }),
      null,
      async (url) => { destinations.push(url); },
      undefined,
      async (branch) => persisted.get(treeOfLifeRelativePathFromBranch(branch))?.webUrl ?? null,
    );
    expect(destinations).toEqual(["https://drive.google.com/drive/folders/BFLX123"]);
  });

  it("leaves Drive unchanged for absent and unresolved Branches", async () => {
    const route = vi.fn(async () => undefined);
    const resolveDrive = vi.fn(async () => null);
    await routePlayDescriptionAux(play(), null, route, undefined, resolveDrive);
    expect(resolveDrive).not.toHaveBeenCalled();

    await routePlayDescriptionAux(
      play({ branch: "Blue Field Law\\Missing" }),
      null,
      route,
      undefined,
      resolveDrive,
    );
    expect(resolveDrive).toHaveBeenCalledWith("Blue Field Law\\Missing");
    expect(route).not.toHaveBeenCalled();
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
