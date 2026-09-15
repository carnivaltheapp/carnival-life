import { describe, expect, it } from "vitest";

import { validateCompanionFolderRequest } from "./companion-folder";

describe("Windows companion folder requests", () => {
  const folders = ["Clients", "Clients/Acme", "Blue Field Law", "Blue Field Law/Automation", "A", "A/B", "A/B/C"];

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

  it("preserves the exact nested parent for Branch and deep-folder creation", () => {
    expect(validateCompanionFolderRequest({
      name: "BFLX",
      parentRelativePath: "Blue Field Law\\Automation",
    }, folders)).toEqual({
      error: null,
      name: "BFLX",
      parentRelativePath: "Blue Field Law/Automation",
    });
    expect(validateCompanionFolderRequest({ name: "D", parentRelativePath: "A/B/C" }, folders))
      .toEqual({ error: null, name: "D", parentRelativePath: "A/B/C" });
  });

  it("permits intentional root creation without treating invalid parents as root", () => {
    expect(validateCompanionFolderRequest({ name: "Test Folder", parentRelativePath: "" }, folders))
      .toEqual({ error: null, name: "Test Folder", parentRelativePath: "" });
    for (const parentRelativePath of ["Blue Field Law/Does Not Exist", "../BFLX", "C:\\OtherFolder", "\\\\server\\share"]) {
      const result = validateCompanionFolderRequest({ name: "BFLX", parentRelativePath }, folders);
      expect(result.error).toContain("existing synced parent");
      expect(result.parentRelativePath).toBeNull();
    }
  });
});
