import { describe, expect, it } from "vitest";

import { getSafeNextPath } from "./redirect";

describe("getSafeNextPath", () => {
  it("preserves local paths, queries, and fragments", () => {
    expect(getSafeNextPath("/?basket=play#list")).toBe("/?basket=play#list");
  });

  it.each([
    null,
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "javascript:alert(1)",
  ])("rejects an unsafe destination: %s", (destination) => {
    expect(getSafeNextPath(destination)).toBe("/");
  });
});
