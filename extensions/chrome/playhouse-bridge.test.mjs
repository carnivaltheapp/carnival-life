import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridgeSource = await readFile(new URL("./playhouse-bridge.js", import.meta.url), "utf8");

test("manifest injects the Aux bridge on the production PlayHouse origin", async () => {
  const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.content_scripts[0].matches.includes(
    "https://carnival-playhouse.vercel.app/*",
  ));
});

test("content script receives the page request and forwards canonical openInAux", async () => {
  let messageListener;
  const messages = [];
  const logs = [];
  const pageWindow = {
    addEventListener(type, listener) {
      if (type === "message") messageListener = listener;
    },
    location: { origin: "https://carnival-playhouse.vercel.app" },
  };
  vm.runInNewContext(bridgeSource, {
    chrome: {
      runtime: {
        async sendMessage(message) {
          messages.push(message);
          return { ok: true };
        },
      },
    },
    console: {
      error(...values) { logs.push(["error", ...values]); },
      info(...values) { logs.push(["info", ...values]); },
    },
    Error,
    window: pageWindow,
  });

  assert.equal(logs[0][1], "Carnival Aux bridge content script loaded");
  messageListener({
    data: { source: "carnival-playhouse", type: "openInAux", url: "https://example.com" },
    origin: "https://different.example",
  });
  assert.equal(messages.length, 0);

  messageListener({
    data: { source: "carnival-playhouse", type: "openInAux", url: "https://example.com" },
    origin: pageWindow.location.origin,
  });
  await Promise.resolve();

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "openInAux");
  assert.equal(messages[0].url, "https://example.com");
  assert.equal(logs.some((entry) => entry[1] === "Carnival Aux bridge request received"), true);
  assert.equal(logs.some((entry) => entry[1] === "Carnival Aux bridge request completed"), true);
});
