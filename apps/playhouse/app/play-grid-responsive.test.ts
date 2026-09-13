import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const playhouseShell = readFileSync(
  new URL("../components/playhouse-shell.tsx", import.meta.url),
  "utf8",
);

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return stylesheet.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

describe("Play grid responsive squeeze contract", () => {
  it("uses one shared Branch-first template for headers and rows", () => {
    const sharedRule = rule(".playGridHeader");

    expect(sharedRule).toContain("--play-description-group-min: 200px");
    expect(sharedRule).toContain("--play-description-group-preferred: 410px");
    expect(sharedRule).toContain("minmax(0, 1fr)");
    expect(sharedRule).toContain("--play-action-columns-width: 143px");
    expect(sharedRule).toContain("--play-grid-inline-inset: clamp(8px, 1.4vw, 14px)");
    expect(sharedRule).toContain("padding: 3px var(--play-grid-inline-inset)");
  });

  it("keeps the original symmetric outer margin while reclaiming navigation width", () => {
    const workspaceRule = rule(".workspaceBody");

    expect(workspaceRule).toContain("grid-template-columns: 160px minmax(0, 1fr)");
    expect(workspaceRule).toContain("padding: clamp(24px, 4vw, 52px)");
    expect(workspaceRule).toContain("padding-right: 100px");
  });

  it("removes the Play dot column without removing the selection control", () => {
    expect(rule(".playIdentityCell")).toContain(
      "grid-template-columns: 112px minmax(0, 1fr)",
    );
    expect(rule(".playSelectControl")).toContain("position: absolute");
    expect(stylesheet).not.toContain(".playTypeMarker");
  });

  it("moves the deployment marker exactly 100px left", () => {
    expect(rule(".versionStamp")).toContain("right: 108px");
    expect(rule(".versionStamp")).toContain("bottom: 6px");
  });

  it("renders the Bullseye as a 38px purple SVG target without a caption", () => {
    const controlRule = rule(".bullseyeControl");

    expect(controlRule).toContain("width: 38px");
    expect(controlRule).toContain("height: 38px");
    expect(controlRule).toContain("color: var(--accent)");
    expect(controlRule).toContain("border-radius: 50%");
    expect(playhouseShell).toContain('className="bullseyeIcon"');
    expect(playhouseShell).toContain('<circle cx="16" cy="16"');
    expect(playhouseShell).not.toMatch(/<\/svg>\s*Bullseye/);
  });

  it("centers the Bullseye and reserves its action bar above the grid header", () => {
    expect(rule(".bullseyeSwitcher")).toContain("width: 38px");
    expect(rule(".bullseyeSwitcher")).toContain("margin: 0 auto 8px");
    expect(rule(".bullseyeCategories")).toContain("top: 0");
    expect(rule(".bullseyeCategories")).toContain("left: 43px");
    expect(rule(".playPanel::before")).toContain("height: 46px");
  });

  it("preserves the complete five-icon action width without horizontal scrolling", () => {
    expect(rule(".statusActionArea")).toContain("width: 143px");
    expect(rule(".statusActions")).toContain("width: 143px");
    expect(rule(".playList")).toContain("overflow-x: hidden");
    expect(rule(".playRow")).toContain("min-width: 0");
    expect(stylesheet).toMatch(/\.playGridHeader\s*\{\s*min-width:\s*0/);
  });
});
