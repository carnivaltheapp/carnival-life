import { describe, expect, it } from "vitest";

import {
  branchTreeFromFolders,
  buildBranchTree,
  buildFolderTree,
  flattenBranchTree,
  parseFolderImage,
  searchBranchTree,
  searchFolderTree,
} from "./tree-of-life";

const nativeTree = [{
  children: [{
    children: [{
      children: [{ children: [], name: "Agencies", relativePath: "Blue Field Law/Marketing/Paid Marketing/Agencies", selectable: true }],
      name: "Paid Marketing",
      relativePath: "Blue Field Law/Marketing/Paid Marketing",
      selectable: true,
    }],
    name: "Marketing",
    relativePath: "Blue Field Law/Marketing",
    selectable: false,
  }],
  name: "Blue Field Law",
  relativePath: "Blue Field Law",
  selectable: true,
}];

describe("Tree of Life hierarchy", () => {
  it("validates and flattens canonical relative paths through 3+ levels", () => {
    expect(flattenBranchTree(nativeTree)).toEqual([
      expect.objectContaining({ depth: 0, parentRelativePath: null, relativePath: "Blue Field Law" }),
      expect.objectContaining({ depth: 1, parentRelativePath: "Blue Field Law", relativePath: "Blue Field Law/Marketing" }),
      expect.objectContaining({ depth: 2, parentRelativePath: "Blue Field Law/Marketing" }),
      expect.objectContaining({ depth: 3, parentRelativePath: "Blue Field Law/Marketing/Paid Marketing" }),
    ]);
  });

  it("builds a deterministic top-level hierarchy from unordered Mongo records", () => {
    const records = flattenBranchTree(nativeTree).toReversed();
    expect(buildBranchTree(records)).toEqual(nativeTree);
  });

  it("rejects malformed and duplicate paths rather than importing partial data", () => {
    expect(() => flattenBranchTree([{ ...nativeTree[0], relativePath: "C:\\Google Drive\\Blue Field Law" }])).toThrow();
    expect(() => flattenBranchTree([nativeTree[0], nativeTree[0]])).toThrow();
  });

  it("searches selectable Branch names and complete paths case-insensitively", () => {
    const tree = buildBranchTree(flattenBranchTree(nativeTree));
    expect(searchBranchTree(tree, "MARKETING").map((branch) => branch.relativePath)).toEqual([
      "Blue Field Law/Marketing/Paid Marketing",
      "Blue Field Law/Marketing/Paid Marketing/Agencies",
    ]);
    expect(searchBranchTree(tree, "paid marketing/agencies").map((branch) => branch.name))
      .toEqual(["Agencies"]);
    expect(searchBranchTree(tree, "Blue Field Law/Marketing")).not.toContainEqual(
      expect.objectContaining({ relativePath: "Blue Field Law/Marketing" }),
    );
  });

  it("builds every folder while deriving a Branch-only hierarchy", () => {
    const records = parseFolderImage([
      { isBranch: false, name: "Personal", relativePath: "Personal" },
      { isBranch: true, name: "Me", relativePath: "Personal/Me" },
      { isBranch: false, name: "Downloads", relativePath: "Downloads" },
    ]);
    const folders = buildFolderTree(records);
    expect(folders).toHaveLength(2);
    expect(folders.find((folder) => folder.name === "Downloads")).toBeTruthy();
    expect(searchFolderTree(folders, "PERSONAL/me")).toEqual([
      expect.objectContaining({ isBranch: true, relativePath: "Personal/Me" }),
    ]);
    expect(branchTreeFromFolders(folders)).toEqual([{
      children: [{ children: [], name: "Me", relativePath: "Personal/Me", selectable: true }],
      name: "Personal",
      relativePath: "Personal",
      selectable: false,
    }]);
  });

  it("rejects root-prefixed, traversing, and duplicate folder paths", () => {
    expect(() => parseFolderImage([{ name: "Blue", relativePath: "C:/Google Drive/Blue" }])).toThrow();
    expect(() => parseFolderImage([{ name: "Blue", relativePath: "../Blue" }])).toThrow();
    expect(() => parseFolderImage([
      { name: "Blue", relativePath: "Blue" },
      { name: "Blue", relativePath: "Blue" },
    ])).toThrow();
  });
});
