import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("./public-feature.module.css", import.meta.url), "utf8");

describe("public Development feature page contract", () => {
  it("is a dynamic server-rendered, unauthenticated, known-ID-only page", () => {
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain("loadPublicDevelopmentFeature(featureId)");
    expect(source).toContain("if (!feature) notFound()");
    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("createClient");
    expect(source).not.toContain("SignedOutScreen");
    expect(source).not.toContain("ownerUserId");
  });

  it("renders the complete public feature fields and full wrapping text", () => {
    for (const field of [
      "feature.featureId", "feature.title", "feature.description", "feature.component",
      "feature.status", "feature.priority", "feature.sequence", "feature.dependencies",
      "feature.notes", "feature.updatedAt",
    ]) expect(source).toContain(field);
    expect(css).toContain("white-space: pre-wrap");
    expect(source).not.toContain("slice(");
    expect(source).not.toMatch(/button|input|textarea|select/);
  });

  it("opts out of search indexing and exposes no roadmap navigation", () => {
    expect(source).toContain("robots: { follow: false, index: false }");
    expect(source).not.toContain("href=");
    expect(source).not.toContain("All Features");
    expect(source).not.toContain("Search features");
  });
});
