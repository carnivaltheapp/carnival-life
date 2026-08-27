import { describe, expect, it } from "vitest";

import { resolvePlayhouseDataSource } from "./data-source";

describe("resolvePlayhouseDataSource", () => {
  it.each([
    [undefined, "mongo"],
    ["", "mongo"],
    ["mongo", "mongo"],
    ["supabase", "supabase"],
  ])("resolves %s to %s", (value, expected) => {
    expect(resolvePlayhouseDataSource(value)).toBe(expected);
  });

  it("rejects invalid values instead of silently choosing a store", () => {
    expect(() => resolvePlayhouseDataSource("postgres")).toThrow(
      "PLAYHOUSE_DATA_SOURCE must be either mongo or supabase.",
    );
  });
});
