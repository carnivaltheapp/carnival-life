import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("./workspace-surface-toggle.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./playhouse-shell.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("WorkspaceSurfaceToggle", () => {
  it("renders one compact Aux/Misc switch in the PlayHouse header", () => {
    expect(component).toContain("Aux ⇄ Misc");
    expect(component).toContain('type="button"');
    expect(component).toContain("toggleRightSurface()");
    expect(shell).toContain("<WorkspaceSurfaceToggle />");
    expect(stylesheet).toMatch(/\.workspaceSurfaceToggle\s*\{[\s\S]*min-height:\s*32px/);
    expect(stylesheet).toMatch(/\.workspaceSurfaceToggle\s*\{[\s\S]*white-space:\s*nowrap/);
  });
});
