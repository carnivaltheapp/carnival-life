import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridgeSource = await readFile(new URL("./playhouse-bridge.js", import.meta.url), "utf8");
const messagingSource = await readFile(new URL("./extension-messaging.js", import.meta.url), "utf8");
const backgroundSource = await readFile(new URL("./background.js", import.meta.url), "utf8");

test("manifest injects the Aux bridge on the production PlayHouse origin", async () => {
  const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.content_scripts[0].matches.includes(
    "https://carnival-playhouse.vercel.app/*",
  ));
});

test("content script relays list-row diagnostics to the authenticated PlayHouse page", () => {
  let runtimeListener;
  const events = [];
  const listeners = new Map();
  class TestCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init.detail; }
  }
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
    CustomEvent: TestCustomEvent,
    clearTimeout,
    chrome: { runtime: { onMessage: { addListener(listener) { runtimeListener = listener; } } } },
    console: { info() {} },
    crypto: { randomUUID: () => "relay-1" },
    setTimeout,
    window: {
      addEventListener(type, listener) {
        const existing = listeners.get(type) ?? [];
        existing.push(listener);
        listeners.set(type, existing);
      },
      dispatchEvent(event) {
        events.push(event);
        for (const listener of listeners.get(event.type) ?? []) listener(event);
      },
      location: { origin: "https://carnival-playhouse.vercel.app" },
      removeEventListener(type, listener) {
        listeners.set(type, (listeners.get(type) ?? []).filter((value) => value !== listener));
      },
    },
  });
  const diagnostic = {
    correlationId: "list-1",
    reason: "completed",
    rowRecognized: true,
    stage: "LIST_ROW_POINTERDOWN",
  };
  let response;
  assert.equal(runtimeListener(
    { diagnostic, type: "recordGmailListRowDiagnostic" },
    null,
    (value) => { response = value; },
  ), true);
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [{
    detail: JSON.stringify({ diagnostic, requestId: "relay-1" }),
    type: "carnival:gmail-list-row-diagnostic",
  }]);
  const result = new TestCustomEvent("carnival:gmail-list-row-diagnostic-result", {
    detail: JSON.stringify({ ok: true, requestId: "relay-1" }),
  });
  for (const listener of listeners.get(result.type) ?? []) listener(result);
  assert.deepEqual(JSON.parse(JSON.stringify(response)), { ok: true, reason: "completed" });

  response = undefined;
  runtimeListener(
    { diagnostic, type: "recordGmailListRowDiagnostic" },
    null,
    (value) => { response = value; },
  );
  const failed = new TestCustomEvent("carnival:gmail-list-row-diagnostic-result", {
    detail: JSON.stringify({ ok: false, requestId: "relay-1" }),
  });
  for (const listener of listeners.get(failed.type) ?? []) listener(failed);
  assert.deepEqual(JSON.parse(JSON.stringify(response)), {
    ok: false,
    reason: "diagnostic_post_failed",
  });
  assert.match(backgroundSource, /status: "diagnostic_created"/);
  assert.match(backgroundSource, /"diagnostic_relay_succeeded"/);
  assert.match(backgroundSource, /"diagnostic_relay_failed"/);
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
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
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
  await new Promise((resolve) => setTimeout(resolve, 0));

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
  await new Promise((resolve) => setTimeout(resolve, 0));
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

test("stale content script reports unavailable runtime without an uncaught exception", async () => {
  let messageListener;
  const logs = [];
  const pageMessages = [];
  const pageWindow = {
    addEventListener(type, listener) { if (type === "message") messageListener = listener; },
    location: { origin: "https://carnival-playhouse.vercel.app" },
    postMessage(message, origin) { pageMessages.push({ message, origin }); },
  };
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
    console: {
      info(...values) { logs.push(["info", ...values]); },
      warn(...values) { logs.push(["warn", ...values]); },
    },
    globalThis: {},
    window: pageWindow,
  });

  assert.doesNotThrow(() => messageListener({
    data: {
      requestId: "stale-bridge-1",
      source: "carnival-playhouse",
      type: "openInAux",
      url: "https://example.com",
    },
    origin: pageWindow.location.origin,
  }));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(logs.some((entry) => (
    entry[0] === "warn" &&
    entry[1] === "Carnival Aux routing unavailable: Carnival extension was reloaded. Refresh PlayHouse." &&
    entry[2]?.code === "EXTENSION_CONTEXT_UNAVAILABLE"
  )), true);
  assert.deepEqual(JSON.parse(JSON.stringify(pageMessages)), [{
    message: {
      code: "EXTENSION_CONTEXT_UNAVAILABLE",
      message: "Carnival extension was reloaded. Refresh PlayHouse.",
      ok: false,
      requestId: "stale-bridge-1",
      source: "carnival-playhouse-bridge",
      type: "openInAuxResult",
    },
    origin: pageWindow.location.origin,
  }]);
});

test("invalidated extension context returns a controlled bridge failure", async () => {
  let messageListener;
  const logs = [];
  const pageMessages = [];
  const pageWindow = {
    addEventListener(type, listener) { if (type === "message") messageListener = listener; },
    location: { origin: "https://carnival-playhouse.vercel.app" },
    postMessage(message) { pageMessages.push(message); },
  };
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
    chrome: {
      runtime: {
        sendMessage() { throw new Error("Extension context invalidated."); },
      },
    },
    console: {
      info() {},
      warn(...values) { logs.push(values); },
    },
    Error,
    window: pageWindow,
  });

  messageListener({
    data: {
      requestId: "invalidated-1",
      source: "carnival-playhouse",
      type: "openInAux",
      url: "https://example.com",
    },
    origin: pageWindow.location.origin,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(logs.some(([event, details]) => (
    event === "Carnival Aux routing unavailable: Carnival extension was reloaded. Refresh PlayHouse." &&
    details.code === "EXTENSION_CONTEXT_UNAVAILABLE"
  )), true);
  assert.equal(pageMessages[0].ok, false);
  assert.equal(pageMessages[0].code, "EXTENSION_CONTEXT_UNAVAILABLE");
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
  const branches = [{ children: [], name: "Carnival", relativePath: "Carnival", selectable: true }];
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
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
  await new Promise((resolve) => setTimeout(resolve, 0));

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
  assert.match(backgroundSource, /nativePort\.postMessage\(\{ requestId, type: "GET_BRANCH_TREE" \}\)/);
  assert.match(backgroundSource, /message\?\.type === "BRANCH_TREE_RESULT"/);
  assert.match(backgroundSource, /branchHierarchyCache = message\.branches/);
});
