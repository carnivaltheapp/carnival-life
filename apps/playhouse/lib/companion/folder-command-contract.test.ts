import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync(new URL("../../app/companion/actions.ts", import.meta.url), "utf8");
const component = readFileSync(new URL("../../components/desktop-companion-settings.tsx", import.meta.url), "utf8");
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
    expect(component).toContain('status.status === "completed"');
    expect(component).toContain("Folder creation is still pending");
  });

  it("offers parent, folder name, and optional Branch state", () => {
    expect(component).toContain("Parent");
    expect(component).toContain("Folder name");
    expect(component).toContain("Make this folder a Branch");
  });
});
