import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("./", import.meta.url);

test("feature and content scripts use the shared runtime messaging layer", async () => {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .filter((name) => !["background.js", "extension-messaging.js"].includes(name));
  for (const file of files) {
    const source = await readFile(new URL(file, directory), "utf8");
    assert.doesNotMatch(source, /\bchrome\.runtime\.sendMessage\s*\(/,
      `${file} bypasses extension-messaging.js`);
  }
});

test("no privileged content script is injected into the main world", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
  for (const definition of manifest.content_scripts) assert.notEqual(definition.world, "MAIN");
});
