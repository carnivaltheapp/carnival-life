import { describe, expect, it } from "vitest";

import { validateCompanionFolderRequest } from "./companion-folder";

describe("Windows companion folder requests", () => {
  const folders = ["Clients", "Clients/Acme"];

  it("accepts a child beneath a synchronized parent", () => {
    expect(validateCompanionFolderRequest({ name: "Campaign", parentRelativePath: "Clients/Acme" }, folders))
      .toEqual({ error: null, name: "Campaign", parentRelativePath: "Clients/Acme" });
  });

  it.each(["../escape", "bad/name", "CON", "trailing.", "trailing "])("rejects unsafe name %s", (name) => {
    expect(validateCompanionFolderRequest({ name, parentRelativePath: "Clients" }, folders).error).toBeTruthy();
  });

  it("rejects an unknown parent and an existing folder", () => {
    expect(validateCompanionFolderRequest({ name: "New", parentRelativePath: "../outside" }, folders).error)
      .toContain("existing synced parent");
    expect(validateCompanionFolderRequest({ name: "Acme", parentRelativePath: "Clients" }, folders).error)
      .toContain("already exists");
  });
});
