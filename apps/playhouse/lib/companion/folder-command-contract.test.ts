import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync(new URL("../../app/companion/actions.ts", import.meta.url), "utf8");
const navigator = readFileSync(new URL("../../components/all-folder-navigator.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../../components/desktop-companion-settings.tsx", import.meta.url), "utf8");
const repository = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");

describe("remote Windows folder command contract", () => {
  it("binds requests and status checks to the authenticated owner", () => {
    expect(actions).toContain("const ownerUserId = await ownerId()");
    expect(repository).toContain("owner_user_id: ownerUserId");
    expect(repository).toContain("device_id: deviceId");
    expect(actions).not.toMatch(/input\.owner|ownerUserId:\s*input/);
  });

  it("requires a recently authenticated device and does not claim success while pending", () => {
    expect(actions).toContain("Date.now() - 30_000");
    expect(navigator).toContain('status.status !== "pending"');
    expect(navigator).toContain("Companion operation is still pending");
  });

  it("offers parent, folder name, and optional Branch state", () => {
    expect(navigator).toContain("parentRelativePath");
    expect(navigator).toContain("Folder name");
    expect(navigator).toContain("Make this a Branch");
    expect(settings).not.toContain("Create folder on Windows");
  });
});
