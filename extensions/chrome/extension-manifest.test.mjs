import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("./", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));

test("extension manifest references existing isolated-world scripts", async () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  await access(new URL(manifest.background.service_worker, directory));
  for (const definition of manifest.content_scripts) {
    assert.notEqual(definition.world, "MAIN");
    assert.equal(definition.js[0], "extension-messaging.js");
    for (const script of definition.js) await access(new URL(script, directory));
  }
});

test("extension manifest retains bridge, Gmail, display, and native permissions", () => {
  for (const permission of ["nativeMessaging", "scripting", "storage", "system.display", "tabs"]) {
    assert.ok(manifest.permissions.includes(permission), `missing permission: ${permission}`);
  }
  assert.ok(manifest.host_permissions.includes("https://mail.google.com/*"));
  assert.ok(manifest.content_scripts.some(({ js, matches }) => (
    js.includes("playhouse-bridge.js") &&
    matches.includes("https://carnival-playhouse.vercel.app/*") &&
    matches.includes("http://localhost/*")
  )));
});
