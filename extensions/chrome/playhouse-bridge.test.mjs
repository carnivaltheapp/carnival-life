import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridgeSource = await readFile(new URL("./playhouse-bridge.js", import.meta.url), "utf8");
const backgroundSource = await readFile(new URL("./background.js", import.meta.url), "utf8");

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
  const pageMessages = [];
  const pageWindow = {
    addEventListener(type, listener) {
      if (type === "message") messageListener = listener;
    },
    location: { origin: "https://carnival-playhouse.vercel.app" },
    postMessage(message, origin) { pageMessages.push({ message, origin }); },
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

  messageListener({
    data: {
      requestId: "description-route-1",
      source: "carnival-playhouse",
      type: "openInAux",
      url: "https://mail.google.com/mail/u/0/#all/FMexact",
    },
    origin: pageWindow.location.origin,
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(pageMessages)), [{
    message: {
      ok: true,
      requestId: "description-route-1",
      source: "carnival-playhouse-bridge",
      type: "openInAuxResult",
    },
    origin: pageWindow.location.origin,
  }]);
});

test("content script forwards one compact local Branch hierarchy response", async () => {
  let messageListener;
  const logs = [];
  const runtimeMessages = [];
  const pageMessages = [];
  const pageWindow = {
    addEventListener(type, listener) { if (type === "message") messageListener = listener; },
    location: { origin: "https://carnival-playhouse.vercel.app" },
    postMessage(message, origin) { pageMessages.push({ message, origin }); },
  };
  const branches = [{ children: [], name: "Carnival", path: "Carnival", selectable: true }];
  vm.runInNewContext(bridgeSource, {
    chrome: { runtime: { async sendMessage(message) { runtimeMessages.push(message); return { branches, ok: true }; } } },
    console: {
      error(...values) { logs.push(["error", ...values]); },
      info(...values) { logs.push(["info", ...values]); },
      warn(...values) { logs.push(["warn", ...values]); },
    },
    window: pageWindow,
  });

  messageListener({
    data: { requestId: "branch-1", source: "carnival-playhouse", type: "getLocalBranches" },
    origin: pageWindow.location.origin,
  });
  await Promise.resolve();

  assert.deepEqual(JSON.parse(JSON.stringify(runtimeMessages)), [{ type: "getLocalBranches" }]);
  assert.equal(logs.some((entry) => entry[1] === "BRANCH_TREE_EXTENSION_RECEIVED"), true);
  assert.equal(logs.some((entry) => entry[1] === "BRANCH_TREE_DELIVERED"), true);
  assert.deepEqual(JSON.parse(JSON.stringify(pageMessages[0].message)), {
    branches,
    ok: true,
    requestId: "branch-1",
    source: "carnival-playhouse-bridge",
    type: "localBranchesResult",
  });
});

test("extension forwards local Branch discovery to the existing native host", () => {
  assert.match(backgroundSource, /message\?\.type === GET_LOCAL_BRANCHES/);
  assert.match(backgroundSource, /nativePort\.postMessage\(\{ requestId, type: "getBranches" \}\)/);
  assert.match(backgroundSource, /message\?\.type === "branchesResult"/);
  assert.match(backgroundSource, /branchHierarchyCache = message\.branches/);
});
