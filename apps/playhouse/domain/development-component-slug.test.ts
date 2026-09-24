import { describe, expect, it } from "vitest";

import { developmentComponentSlug } from "./development-component-slug";

describe("Development component slugs", () => {
  it.each([
    ["Gmail", "gmail"],
    ["PlayHouse", "playhouse"],
    ["Mobile / PWA", "mobile-pwa"],
    ["Contacts & Players", "contacts-players"],
    ["  Carnival AI  ", "carnival-ai"],
  ])("derives %s from the current component name", (name, slug) => {
    expect(developmentComponentSlug(name)).toBe(slug);
  });
});
