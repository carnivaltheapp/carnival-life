import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return stylesheet.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

describe("Play grid responsive squeeze contract", () => {
  it("uses one shared Branch-first template for headers and rows", () => {
    const sharedRule = rule(".playRowLine,\n.playGridHeader");

    expect(sharedRule).toContain("--play-description-group-min: 200px");
    expect(sharedRule).toContain("--play-description-group-preferred: 418px");
    expect(sharedRule).toContain("minmax(0, 1fr)");
    expect(sharedRule).toContain("--play-action-columns-width: 143px");
    expect(sharedRule).toContain("--play-grid-inline-inset: clamp(6px, 0.8vw, 10px)");
    expect(sharedRule).toContain("padding: 3px var(--play-grid-inline-inset)");
  });

  it("uses the compact navigation width to widen the Description group", () => {
    expect(rule(".workspaceBody")).toContain(
      "grid-template-columns: clamp(144px, 10.5vw, 152px) minmax(0, 1fr)",
    );
    expect(rule(".workspaceBody")).toContain("padding: clamp(24px, 4vw, 52px)");
  });

  it("keeps the deployment marker inside the viewport safe area", () => {
    const markerRule = rule(".versionStamp");

    expect(markerRule).toContain("right: max(12px, env(safe-area-inset-right))");
    expect(markerRule).toContain("bottom: max(10px, env(safe-area-inset-bottom))");
    expect(markerRule).toContain("white-space: nowrap");
  });

  it("preserves the complete five-icon action width without horizontal scrolling", () => {
    expect(rule(".statusActionArea")).toContain("width: 143px");
    expect(rule(".statusActions")).toContain("width: 143px");
    expect(rule(".playList")).toContain("overflow-x: hidden");
    expect(rule(".playRow")).toContain("min-width: 0");
    expect(stylesheet).toMatch(/\.playGridHeader\s*\{\s*min-width:\s*0/);
  });

  it("reclaims the former dot column while preserving edge selection feedback", () => {
    expect(rule(".playIdentityCell")).toContain(
      "grid-template-columns: 112px minmax(0, 1fr)",
    );
    expect(rule(".playSelectControl")).toContain("position: absolute");
    expect(stylesheet).not.toContain(".playTypeMarker");
  });
});
