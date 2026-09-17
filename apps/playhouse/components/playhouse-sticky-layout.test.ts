import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("./playhouse-shell.tsx", import.meta.url), "utf8");

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return stylesheet.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

describe("PlayHouse frozen reference layout", () => {
  it("keeps the application header on the existing page scroll", () => {
    expect(rule(".appHeader")).toContain("position: sticky");
    expect(rule(".appHeader")).toContain("top: 0");
    expect(rule("body")).not.toContain("overflow-y");
    expect(rule(".workspaceBody")).not.toContain("overflow-y");
  });

  it("freezes the crown and grid headings as one opaque group", () => {
    const header = rule(".playPanelHeader");
    expect(shell).toContain('className="playPanelHeader"');
    expect(header).toContain("position: sticky");
    expect(header).toContain("var(--app-header-height)");
    expect(header).toContain("background: #fffdfb");
    expect(rule(".playPanel")).toContain("overflow: clip");
  });

  it("freezes the Bullseye and every destination item at the same row offset", () => {
    const navigation = rule(".destinationNav");
    expect(shell.indexOf('className="bullseyeSwitcher"')).toBeLessThan(
      shell.indexOf('className="navItems"'),
    );
    expect(navigation).toContain("position: sticky");
    expect(navigation).toContain("var(--app-header-height)");
    expect(navigation).toContain("var(--workspace-block-inset)");
  });

  it("leaves Play rows in normal document flow without another vertical scroller", () => {
    expect(rule(".playList")).toContain("overflow-x: hidden");
    expect(rule(".playList")).not.toContain("overflow-y");
    expect(rule(".playRow")).not.toContain("position: sticky");
  });
});
