import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repository = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/companion/pair/route.ts", import.meta.url), "utf8");
const nativeHost = readFileSync(
  new URL("../../../../desktop/workspace/windows/CarnivalWorkspaceHost.cs", import.meta.url),
  "utf8",
);

describe("secure companion pairing contract", () => {
  it("consumes an unexpired code once and stores only credential hashes", () => {
    expect(repository).toContain('consumed_at: null, expires_at: { $gt: now }');
    expect(repository).toContain('credential_hash: secretHash(credential)');
    expect(repository).not.toMatch(/credential:\s*credential/);
    expect(repository).toContain('status: "active"');
  });

  it("does not accept an owner id at the public exchange boundary", () => {
    expect(route).not.toContain("owner_user_id");
    expect(route).not.toContain("ownerUserId");
    expect(route).toContain("exchangePairingCode(code, deviceName)");
  });

  it("stores the credential using current-user DPAPI and never embeds Mongo credentials", () => {
    expect(nativeHost).toContain("DataProtectionScope.CurrentUser");
    expect(nativeHost).toContain("ProtectedData.Protect");
    expect(nativeHost).not.toContain("LEGACY_MONGO_URI");
    expect(nativeHost).not.toContain("mongodb://");
  });
});
