import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const player = readFileSync(new URL("./player-combobox.tsx", import.meta.url), "utf8");
const branch = readFileSync(new URL("./branch-picker.tsx", import.meta.url), "utf8");

describe("PlayHouse floating UI layers", () => {
  it("defines one ordered layer scale for detail, sticky UI, actions, popovers, and modals", () => {
    expect(stylesheet).toMatch(/--z-detail: 20;[\s\S]*--z-sticky: 30;[\s\S]*--z-actions: 40;[\s\S]*--z-popover: 60;[\s\S]*--z-modal: 80;/);
    expect(stylesheet).toMatch(/\.playDetailActions[\s\S]*?z-index: var\(--z-actions\);/);
  });

  it("lets Player autocomplete escape its former lower parent stacking context", () => {
    expect(stylesheet).toMatch(/\.playerField\s*\{\s*z-index: auto;/);
    expect(stylesheet).toMatch(/\.playerSearchMenu\s*\{[\s\S]*?z-index: var\(--z-popover\);/);
    expect(player).toContain('className="playerSearchMenu"');
    expect(player).toContain('role="listbox"');
  });

  it("places Branch and contextual choice surfaces above ordinary and sticky UI", () => {
    for (const selector of [
      ".branchPickerMenu",
      ".branchSearchMenu",
      ".accountMenuPopover",
      ".settingsPopover",
      ".gmailContextMenu",
      ".doneCreateForm",
    ]) {
      expect(stylesheet).toMatch(new RegExp(
        selector.replace(".", "\\.") + "[\\s\\S]*?z-index: var\\(--z-popover\\);",
      ));
    }
    expect(branch).toContain('className="branchPickerMenu"');
    expect(branch).toContain('className="branchSearchMenu"');
  });

  it("does not clip menus at detail section boundaries and constrains menu height", () => {
    expect(stylesheet).not.toMatch(/\.playDetailSection\s*\{[^}]*overflow:\s*(?:hidden|auto)/);
    expect(stylesheet).toMatch(/\.playerSearchMenu\s*\{[\s\S]*?overflow-y: auto;[\s\S]*?max-height: 220px;/);
    expect(stylesheet).toMatch(/\.branchPickerMenu,[\s\S]*?\.branchSearchMenu\s*\{[\s\S]*?max-height: min\(330px, 55vh\);[\s\S]*?overflow-y: auto;/);
    expect(stylesheet).toMatch(/\.editDisclosure\[open\] \.playerSearchMenu\s*\{[\s\S]*?bottom: calc\(100% \+ 4px\);[\s\S]*?max-height: min\(220px, 38dvh\);/);
  });

  it("keeps the action bar interactive when no popup occupies its area", () => {
    const actionRule = stylesheet.match(/\.playDetailActions\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(actionRule).not.toContain("pointer-events: none");
  });
});
