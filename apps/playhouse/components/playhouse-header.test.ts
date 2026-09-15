import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync(new URL("./playhouse-shell.tsx", import.meta.url), "utf8");
const icon = readFileSync(new URL("./playhouse-icon.tsx", import.meta.url), "utf8");
const signedOut = readFileSync(new URL("./signed-out-screen.tsx", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../app/manifest.ts", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
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

  it("uses the supplied PlayHouse theater artwork across header, sign-in, manifest, and favicon branding", () => {
    expect(icon).toContain('src="/icons/playhouse-theater.jpg"');
    expect(shell).toContain("<PlayHouseIcon />");
    expect(signedOut).toContain("<PlayHouseIcon />");
    expect(manifest).toContain('src: "/icons/playhouse-theater.jpg"');
    expect(layout).toContain('icon: "/icons/playhouse-theater.jpg"');
    expect(statSync(new URL("../public/icons/playhouse-theater.jpg", import.meta.url)).size).toBeGreaterThan(0);
    expect([shell, signedOut, manifest, layout].join("\n")).not.toContain("carnival-mark.svg");
  });

  it("centers a Details-only header mode while preserving all normal header controls", () => {
    expect(shell).toContain('<h1 className="headerDetailTitle">Details</h1>');
    expect(stylesheet).toMatch(/\.headerDetailTitle\s*\{[\s\S]*?left: 50%;[\s\S]*?transform: translate\(-50%, -50%\);/);
    expect(stylesheet).toMatch(/\.workspace:has\(\.editDisclosure\[open\]\) \.headerDetailTitle\s*\{[\s\S]*?display: block;/);
    expect(stylesheet).toMatch(/\.workspace:has\(\.editDisclosure\[open\]\) \.headerPlayCount,[\s\S]*?\.headerActions\s*\{[\s\S]*?display: none;/);
    expect(shell).toContain('data-testid="play-count"');
    expect(shell).toContain("<PlaySearch");
    expect(shell).toContain('aria-label="Show Branch"');
    expect(shell).toContain("<PlayForm");
    expect(shell).toContain("<AccountMenu");
  });

  it("keeps the Detail title centered on mobile without horizontal brand competition", () => {
    expect(stylesheet).toMatch(/@media \(max-width: 540px\)[\s\S]*?\.workspace:has\(\.editDisclosure\[open\]\) \.brand > span:last-child\s*\{[\s\S]*?display: none;/);
    expect(stylesheet).toMatch(/\.appHeader\s*\{[\s\S]*?position: relative;/);
  });
});
