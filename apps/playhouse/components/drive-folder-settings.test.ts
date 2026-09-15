import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const component = await readFile(new URL("./drive-folder-settings.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./grid-settings.tsx", import.meta.url), "utf8");
const actions = await readFile(new URL("../app/tree-of-life/actions.ts", import.meta.url), "utf8");

describe("Drive folder settings", () => {
  it("offers one compact owner-account backfill action", () => {
    expect(settings).toContain("Drive Folders");
    expect(component).toContain('name="googleAccountId"');
    expect(component).toContain("Resolve Drive Folders");
    expect(component).toContain("backfillTreeOfLifeDriveFolders");
  });

  it("reports the explicit Google reconnect requirement", () => {
    expect(actions).toContain("Google Drive reconnect required. Sign out and sign in with Google to grant access.");
    expect(actions).toContain("GOOGLE_DRIVE_METADATA_READONLY_SCOPE");
  });
});
