import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync(new URL("./playhouse-shell.tsx", import.meta.url), "utf8");
const dataLoader = readFileSync(new URL("../lib/playhouse/data.ts", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("PlayHouse crown and Branch filter", () => {
  it("moves the current view title into the panel crown", () => {
    expect(shell).not.toContain('className="headerViewTitle"');
    expect(shell).toContain('className="playPanelCrown"');
    expect(shell).toContain('className="playPanelCrownTitle" id="view-title">{viewTitle}');
    expect(stylesheet).toMatch(/\.playPanelCrown\s*\{[\s\S]*?height: 46px;/);
    expect(stylesheet).not.toContain(".playPanel::before");
  });

  it("replaces the crown title with the active top-level error", () => {
    expect(shell).toContain('const crownError = moveError ?? (dataError ? "PlayHouse could not load." : null)');
    expect(shell).toMatch(/\{crownError \? \([\s\S]*?playPanelCrownError[\s\S]*?\{crownError\}[\s\S]*?: \([\s\S]*?playPanelCrownTitle/);
    expect(shell).not.toContain('className="moveError"');
  });

  it("renders Show Branch immediately after Search and filters only the grid input", () => {
    expect(shell).toMatch(/<PlaySearch[\s\S]*?<label className="branchFilter">/);
    expect(shell).toContain('<option value={ALL_BRANCHES}>All Branches</option>');
    expect(shell).toContain("filterPlaysByBranch(localPlays, selectedBranch)");
    expect(shell).toContain("sortPlaysForGrid(branchFilteredPlays, gridSort)");
  });

  it("derives Branch options from repository results before search filtering", () => {
    expect(dataLoader).toMatch(
      /branchOptions: playBranchOptions\(result\.plays\)[\s\S]*?plays: searchQuery[\s\S]*?searchPlays\(result\.plays/,
    );
    expect(shell).toContain("validSelectedBranch(branchFilter.selected, branchOptions)");
  });
});
