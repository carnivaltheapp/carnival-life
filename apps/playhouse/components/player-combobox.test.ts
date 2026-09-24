import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("./player-combobox.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("multi-Player contact labels", () => {
  it("supports multiple contact/group selections and stores only their references", () => {
    expect(component).toContain("updateSelected([...selected, response.contact])");
    expect(component).toContain('name="playerEntries"');
    expect(component).toContain("JSON.stringify(selected)");
    expect(component).toContain('selection.kind === "group"');
  });

  it("expands live group members with transient, initially checked local state", () => {
    expect(component).toContain("loadPlayerGroupMembers(group.resourceName)");
    expect(component).toContain("new Set(response.members.map");
    expect(component).toContain('type="checkbox"');
    expect(component).not.toMatch(/name=.*checkedMembers/);
    expect(component).toContain("setCheckedMembers(new Set())");
  });

  it("visually identifies groups and keeps their member list compact", () => {
    expect(component).toContain('className="playerGroupIcon"');
    expect(component).toContain("selection.memberCount} members");
    expect(stylesheet).toContain(".playerGroupMembers");
    expect(stylesheet).toMatch(/\.playerGroupMembers\s*\{[\s\S]*?max-height: 180px;/);
  });
});
