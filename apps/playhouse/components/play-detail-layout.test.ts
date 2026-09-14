import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const playForm = readFileSync(new URL("./play-form.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("full-area Play detail", () => {
  it("covers the PlayHouse body below the retained header", () => {
    expect(stylesheet).toMatch(/\.appHeader\s*\{[\s\S]*?z-index: var\(--z-sticky\);/);
    expect(stylesheet).toMatch(/\.editDisclosure\[open\]\s*\{[\s\S]*?z-index: var\(--z-detail\);[\s\S]*?top: 76px;[\s\S]*?bottom: 0;/);
    expect(stylesheet).toMatch(/width: min\(1440px, 100vw\);/);
    expect(stylesheet).toMatch(/@media[\s\S]*?\.editDisclosure\[open\]\s*\{[\s\S]*?top: 96px;[\s\S]*?width: 100vw;/);
  });

  it("uses the required responsive section order and no Description field", () => {
    const branch = playForm.indexOf(">Branch</h2>");
    const what = playForm.indexOf(">What</h2>");
    const when = playForm.indexOf("When &amp; Where");
    const people = playForm.indexOf("People &amp; Integrations");
    const actions = playForm.indexOf('className="playDetailActions"');
    expect(branch).toBeGreaterThan(0);
    expect(branch).toBeLessThan(what);
    expect(what).toBeLessThan(when);
    expect(when).toBeLessThan(people);
    expect(people).toBeLessThan(actions);
    expect(playForm).toContain('name="title"');
    expect(playForm).toContain('name="note"');
    expect(playForm).not.toContain('name="description"');
    expect(playForm).toContain("<PlayerCombobox");
    expect(playForm).toContain("<PlayerSlackField");
    expect(playForm).toContain('className="jiraPlaceholder"');
    expect(playForm).not.toContain('name="jira"');
  });

  it("switches between Calendar scheduling and a single Basket control", () => {
    expect(playForm).toMatch(/placementKind === "calendar"[\s\S]*?aria-label="Date"[\s\S]*?aria-label="Duration \(minutes\)"[\s\S]*?: \([\s\S]*?aria-label="Basket"/);
    expect(playForm).toContain('basket.slug.toLowerCase() === "backlog"');
    expect(playForm).toContain("initialPlacement.basketId");
    expect(playForm).toContain(": backlogBasketId");
  });

  it("stacks every detail grid on mobile without horizontal scrolling", () => {
    expect(stylesheet).toMatch(/\.playDetailThreeColumnRow,[\s\S]*?\.playDetailPeopleRow\s*\{\s*grid-template-columns: 1fr;/);
    expect(stylesheet).toContain("overflow-x: hidden");
    expect(stylesheet).toMatch(/\.playDetailActions\s*\{[\s\S]*?position: sticky;/);
    expect(stylesheet).toMatch(/\.editDisclosure\[open\] \.playDetailBranchSection \.branchPickerMenu[\s\S]*?width: min\(620px/);
  });

  it("keeps unsupported permanent deletion non-destructive while using real Trash", () => {
    expect(playForm).toMatch(/Delete Play[\s\S]*?disabled/);
    expect(playForm).toContain("<form action={trashAction}>");
    expect(playForm).toContain('requestGmailThreadUnstar(play, "trash")');
  });
});
