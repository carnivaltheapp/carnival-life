import { describe, expect, it } from "vitest";

import type { PlayListItem } from "./play";
import {
  ALL_BRANCHES,
  filterPlaysByBranch,
  playBranchName,
  playBranchOptions,
  validSelectedBranch,
} from "./play-branch-filter";

function play(id: string, branch: string | null, title = id): PlayListItem {
  return {
    basketId: null,
    branch,
    durationMinutes: null,
    id,
    legacyTaskType: "H",
    nextPlayId: null,
    note: null,
    place: null,
    playerContactId: null,
    playerDisplayName: null,
    playType: "normal",
    pushRule: "everyday",
    scheduledDate: "2026-09-14",
    sourceType: "user",
    title,
    url: null,
  };
}

describe("Play Branch filtering", () => {
  it.each([
    ["Google Drive/Marketing/Clients", "Marketing"],
    ["Google Drive/Legal", "Legal"],
    ["Marketing/Clients", "Marketing"],
    ["Personal", "Personal"],
    ["  /google drive//Personal/ ", "Personal"],
    ["C:\\Google Drive\\Legal\\Nonprofits", "Legal"],
    ["", null],
    [null, null],
  ])("normalizes %s to %s", (branch, expected) => {
    expect(playBranchName(branch)).toBe(expected);
  });

  it("deduplicates normalized names and orders them alphabetically", () => {
    expect(playBranchOptions([
      play("1", "Google Drive/Marketing/A"),
      play("2", "Google Drive/Marketing/B"),
      play("3", "Google Drive/Legal/A"),
      play("4", "Google Drive/Personal"),
    ])).toEqual(["Legal", "Marketing", "Personal"]);
  });

  it("filters the current result without collapsing its precomputed options", () => {
    const currentView = [
      play("marketing", "Google Drive/Marketing", "Invoice review"),
      play("legal", "Google Drive/Legal", "Invoice filing"),
      play("personal", "Personal", "Call home"),
    ];
    const options = playBranchOptions(currentView);

    expect(filterPlaysByBranch(currentView, "Marketing").map(({ id }) => id))
      .toEqual(["marketing"]);
    expect(options).toEqual(["Legal", "Marketing", "Personal"]);
    expect(filterPlaysByBranch(currentView, ALL_BRANCHES)).toEqual(currentView);
    expect(filterPlaysByBranch(
      currentView.filter((item) => item.title.toLowerCase().includes("invoice")),
      "Legal",
    ).map(({ id }) => id)).toEqual(["legal"]);
  });

  it("resets a stale selection when a view no longer offers it", () => {
    expect(validSelectedBranch("Marketing", ["Legal", "Marketing"])).toBe("Marketing");
    expect(validSelectedBranch("Marketing", ["Legal"])).toBe(ALL_BRANCHES);
  });
});
