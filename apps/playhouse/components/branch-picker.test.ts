import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const picker = await readFile(new URL("./branch-picker.tsx", import.meta.url), "utf8");
const form = await readFile(new URL("./play-form.tsx", import.meta.url), "utf8");
const actions = await readFile(new URL("../app/tree-of-life/actions.ts", import.meta.url), "utf8");

describe("BranchPicker", () => {
  it("keeps selection and drill-down as separate controls with back navigation", () => {
    expect(picker).toContain("setSelectedBranch(canonicalBranchValue(node.relativePath))");
    expect(picker).toContain("aria-label={`Open ${node.name}`}");
    expect(picker).toContain("setTrail((current) => [...current, node])");
    expect(picker).toContain("setTrail((current) => current.slice(0, -1))");
    expect(picker).toContain("disabled={!node.selectable}");
  });

  it("preserves current Branch and participates in the existing Save/Cancel form lifecycle", () => {
    expect(picker).toContain('<input name="branch" readOnly type="hidden" value={selectedBranch} />');
    expect(picker).toContain("Branches unavailable");
    expect(form).toContain("<BranchPicker initialBranch={submittedValues?.branch ?? play?.branch ?? \"\"} />");
    expect(form).toContain("key={formResetVersion}");
  });

  it("reads Mongo on normal open and reserves the native bridge for deliberate bootstrap", () => {
    expect(picker).toContain("const result = await loadTreeOfLifeBranches()");
    expect(picker).toContain("async function importTreeOfLife()");
    expect(picker).toContain("const local = await loadLocalBranches()");
    expect(picker.indexOf("loadTreeOfLifeBranches()")).toBeLessThan(picker.indexOf("loadLocalBranches()"));
    expect(picker).toContain("Import Tree of Life");
  });

  it("uses a mobile-compatible server read and derives owner scope from the session", () => {
    expect(actions).toContain("export async function loadTreeOfLifeBranches()");
    expect(actions).not.toContain("local-branches");
    expect(actions).not.toContain("window.");
    expect(actions).toContain("const ownerUserId = await authenticatedOwnerId()");
    expect(actions).toContain("getBranchTreeForOwner(ownerUserId)");
    expect(actions).toContain("bootstrapTreeOfLife(tree: unknown)");
  });
});
