import { describe, expect, it } from "vitest";

import { resolveTimeZone } from "./time-zone";

describe("PlayHouse timezone resolution", () => {
  it("uses the validated browser timezone for calendar views", () => {
    expect(resolveTimeZone("America/Los_Angeles", "UTC")).toBe(
      "America/Los_Angeles",
    );
  });

  it("falls back to the profile timezone and then UTC", () => {
    expect(resolveTimeZone("not/a-zone", "America/New_York")).toBe(
      "America/New_York",
    );
    expect(resolveTimeZone("not/a-zone", "also/not-a-zone")).toBe("UTC");
  });
});
