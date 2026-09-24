import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
const view = await readFile(new URL("./public-roadmap.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("./[featureId]/public-feature.module.css", import.meta.url), "utf8");

describe("public All Features roadmap", () => {
  it("keeps the interactive Console for authenticated users and SSR public fallback otherwise", () => {
    expect(page).toContain('state.kind === "signed-in"');
    expect(page).toContain("<DevelopmentConsole");
    expect(page).toContain("loadPublicDevelopmentRoadmap()");
    expect(page).toContain("<PublicDevelopmentRoadmap");
    expect(page).toContain("robots: { follow: false, index: false }");
    expect(view).not.toContain('"use client"');
  });

  it("renders complete planning fields and full Notes without mutation controls", () => {
    expect(view).toContain("features.map");
    for (const field of [
      "feature.featureId", "feature.title", "feature.description", "feature.component",
      "feature.status", "feature.priority", "feature.sequence", "feature.dependencies",
      "feature.notes",
    ]) expect(view).toContain(field);
    expect(css).toContain("white-space: pre-wrap");
    expect(view).not.toMatch(/<button|<input|<textarea|<select|draggable/);
    expect(view).not.toMatch(/owner|Mongo|feature\.id|componentId/);
  });
});
