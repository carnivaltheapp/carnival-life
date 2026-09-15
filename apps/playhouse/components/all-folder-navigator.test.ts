import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigator = readFileSync(new URL("./all-folder-navigator.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("./play-form.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./desktop-companion-settings.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("Detail all-folder navigator", () => {
  it("opens from the Branch heading and retains the normal Branch-only picker", () => {
    expect(form).toContain('className="addBranchButton"');
    expect(form).toContain(">+ Branch</button>");
    expect(form).toContain("<BranchPicker");
    expect(form).toContain("<AllFolderNavigator");
    expect(form).toContain("setBranchTreeVersion((version) => version + 1)");
  });

  it("loads all folders from Mongo with drill, back, path search, and Branch indicators", () => {
    expect(navigator).toContain("loadTreeOfLifeFolders()");
    expect(navigator).toContain("searchFolderTree(roots, query)");
    expect(navigator).toContain("Search Folders");
    expect(navigator).toContain("displayBranchPath(node.relativePath)");
    expect(navigator).toContain('aria-label={`Open ${node.name}`}');
    expect(navigator).toContain("‹ Back");
    expect(navigator).toContain('aria-label="Branch"');
  });

  it("uses companion commands for Make Branch and New Folder without saving the Play", () => {
    expect(navigator).toContain("requestCompanionBranchState(candidate.relativePath, true)");
    expect(navigator).toContain("requestCompanionFolderCreation");
    expect(navigator).toContain("+ New Folder");
    expect(navigator).toContain("Select Branch");
    expect(navigator).not.toContain("savePlay");
  });

  it("uses the selected folder's full navigation trail as the creation parent", () => {
    expect(navigator).toContain("folderTrailForPath(roots, node.relativePath)");
    expect(navigator).toContain("setTrail(nextTrail)");
    expect(navigator).toContain('const currentRelativePath = trail.at(-1)?.relativePath ?? ""');
    expect(navigator).toContain("parentRelativePath: currentRelativePath");
    expect(navigator).not.toContain('parentRelativePath: ""');
  });

  it("keeps Settings administrative and uses responsive modal layering", () => {
    expect(settings).not.toContain("Folder name");
    expect(settings).not.toContain("Create folder");
    expect(settings).toContain("Pair device");
    expect(settings).toContain("Revoke");
    expect(stylesheet).toMatch(/\.settingsPopover\s*\{[\s\S]*?overflow-x: hidden;[\s\S]*?width: min\(560px,/);
    expect(stylesheet).toMatch(/\.allFolderOverlay\s*\{[\s\S]*?z-index: var\(--z-modal\);/);
    expect(stylesheet).toMatch(/@media \(max-width: 540px\)[\s\S]*?\.allFolderNavigator\s*\{[\s\S]*?width: calc\(100vw - 20px\);/);
  });
});
