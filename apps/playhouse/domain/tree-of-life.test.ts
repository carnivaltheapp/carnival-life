import { describe, expect, it } from "vitest";

import { buildBranchTree, flattenBranchTree } from "./tree-of-life";

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
});
