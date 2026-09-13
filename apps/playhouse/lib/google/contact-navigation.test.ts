import { describe, expect, it } from "vitest";

import { googleContactUrl } from "./contact-navigation";

describe("googleContactUrl", () => {
  it("routes a stable Google People resource to its contact page", () => {
    expect(googleContactUrl("people/c123_ABC-9")).toBe(
      "https://contacts.google.com/person/c123_ABC-9",
    );
  });

  it("rejects missing and malformed resource names", () => {
    expect(googleContactUrl("")).toBeNull();
    expect(googleContactUrl("person@example.com")).toBeNull();
    expect(googleContactUrl("people/c123/other")).toBeNull();
  });
});
