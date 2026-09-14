import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const picker = await readFile(new URL("./branch-picker.tsx", import.meta.url), "utf8");
const form = await readFile(new URL("./play-form.tsx", import.meta.url), "utf8");

describe("BranchPicker", () => {
  it("keeps selection and drill-down as separate controls with back navigation", () => {
    expect(picker).toContain("setSelectedBranch(canonicalBranchValue(node.path))");
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
});
