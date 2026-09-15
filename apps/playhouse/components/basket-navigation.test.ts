import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync(new URL("./playhouse-shell.tsx", import.meta.url), "utf8");

describe("Bullseye Basket browsing", () => {
  it("toggles the persistent sidebar mode separately from transient drag categories", () => {
    expect(shell).toContain("const [destinationNavigation, setDestinationNavigation]");
    expect(shell).toContain("const activeDestinationCategory = bullseyeOpen && draggedIds.length");
    expect(shell).toContain("toggleDestinationNavigationMode(current.mode)");
    expect(shell).toContain('? "Show Baskets"');
    expect(shell).toContain(': "Show Calendar"');
  });

  it("uses canonical Basket props, routes by slug, and preserves selected styling", () => {
    expect(shell).toContain("{baskets.map((basket) => {");
    expect(shell).toContain('selectedView.kind === "basket"');
    expect(shell).toContain('href={`/?basket=${encodeURIComponent(basket.slug)}`}');
    expect(shell).toContain('data-active={isActive || undefined}');
  });

  it("keeps a normal Bullseye click mutation-free and Branch filtering downstream", () => {
    const clickHandler = shell.match(/onClick=\{\(\) => \{[\s\S]*?\n\s*\}\}\n\s*onDragEnter=/)?.[0] ?? "";
    expect(clickHandler).toContain("setDestinationNavigation");
    expect(clickHandler).not.toMatch(/persist|applyBulk|router\.push/);
    expect(shell).toContain("filterPlaysByBranch(localPlays, selectedBranch)");
  });
});
