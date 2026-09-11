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
    expect(sharedRule).toContain("--play-description-group-preferred: 330px");
    expect(sharedRule).toContain("minmax(0, 1fr)");
    expect(sharedRule).toContain("--play-action-columns-width: 143px");
  });

  it("preserves the complete five-icon action width without horizontal scrolling", () => {
    expect(rule(".statusActionArea")).toContain("width: 143px");
    expect(rule(".statusActions")).toContain("width: 143px");
    expect(rule(".playList")).toContain("overflow-x: hidden");
    expect(rule(".playRow")).toContain("min-width: 0");
    expect(stylesheet).toMatch(/\.playGridHeader\s*\{\s*min-width:\s*0/);
  });
});
