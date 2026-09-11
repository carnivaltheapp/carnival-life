import assert from "node:assert/strict";
import test from "node:test";

import {
  CarnivalWorkspaceController,
  DEFAULT_CONTEXT_URL,
  defaultWorkspaceLayout,
  isAllowedContextUrl,
} from "./workspace-controller.js";

function fakeChrome() {
  let state = {};
  let nextWindowId = 1;
  let nextTabId = 10;
  const windows = new Map();
  const tabs = new Map();
  const calls = { createWindow: [], updateTab: [], updateWindow: [] };

  return {
    calls,
    closeWindow(id) { windows.delete(id); },
    storage: {
      local: {
        async get() { return state; },
        async set(value) { state = value; },
      },
    },
    tabs: {
      async create(options) {
        const tab = { id: nextTabId++, url: options.url, windowId: options.windowId };
        tabs.set(tab.id, tab);
        return tab;
      },
      async get(id) {
        if (!tabs.has(id)) throw new Error("missing tab");
        return tabs.get(id);
      },
      async query({ url }) {
        const prefix = url.replace("*", "");
        return [...tabs.values()].filter((tab) => tab.url.startsWith(prefix));
      },
      async update(id, options) {
        calls.updateTab.push({ id, options });
        const tab = { ...tabs.get(id), ...options };
        tabs.set(id, tab);
        return tab;
      },
    },
    windows: {
      async create(options) {
        calls.createWindow.push(options);
        const tab = { id: nextTabId++, url: options.url, windowId: nextWindowId };
        const window = { ...options, id: nextWindowId++, tabs: [tab] };
        tabs.set(tab.id, tab);
        windows.set(window.id, window);
        return window;
      },
      async get(id) {
        if (!windows.has(id)) throw new Error("missing window");
        return windows.get(id);
      },
      async update(id, options) {
        calls.updateWindow.push({ id, options });
        const window = { ...windows.get(id), ...options };
        windows.set(id, window);
        return window;
      },
    },
  };
}

test("default workspace is a 40/60 split across the monitor work area", () => {
  assert.deepEqual(defaultWorkspaceLayout({ height: 1000, left: 100, top: 20, width: 2000 }), {
    context: { height: 1000, left: 900, top: 20, width: 1200 },
    playhouse: { height: 1000, left: 100, top: 20, width: 800 },
  });
});

test("context routing accepts browser URLs and rejects privileged schemes", () => {
  assert.equal(isAllowedContextUrl("https://mail.google.com/mail/u/0/#inbox"), true);
  assert.equal(isAllowedContextUrl("http://localhost:3002"), true);
  assert.equal(isAllowedContextUrl("file:///private/data"), false);
  assert.equal(isAllowedContextUrl("javascript:alert(1)"), false);
});

test("repeated summons reuse both identified Chrome windows", async () => {
  const chrome = fakeChrome();
  const controller = new CarnivalWorkspaceController(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };

  const first = await controller.summon(workArea, "display-1");
  const second = await controller.summon(workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 2);
  assert.equal(second.playhouseWindowId, first.playhouseWindowId);
  assert.equal(second.contextWindowId, first.contextWindowId);
  assert.equal(chrome.calls.createWindow[1].url, DEFAULT_CONTEXT_URL);
});

test("opening context reuses the context tab and validates its URL", async () => {
  const chrome = fakeChrome();
  const controller = new CarnivalWorkspaceController(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };

  await controller.openCarnivalContext("https://example.com/play", workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 2);
  assert.deepEqual(chrome.calls.updateTab.at(-1)?.options, {
    active: true,
    url: "https://example.com/play",
  });
  await assert.rejects(
    controller.openCarnivalContext("chrome://settings", workArea, "display-1"),
    /HTTP or HTTPS/,
  );
});

test("a missing workspace side is repaired without duplicating the surviving window", async () => {
  const chrome = fakeChrome();
  const controller = new CarnivalWorkspaceController(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await controller.summon(workArea, "display-1");
  chrome.closeWindow(first.contextWindowId);

  const repaired = await controller.summon(workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 3);
  assert.equal(repaired.playhouseWindowId, first.playhouseWindowId);
  assert.notEqual(repaired.contextWindowId, first.contextWindowId);
});

test("user-resized bounds are restored on the same monitor", async () => {
  const chrome = fakeChrome();
  const controller = new CarnivalWorkspaceController(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await controller.summon(workArea, "display-1");
  await controller.rememberBounds({
    height: 820,
    id: first.playhouseWindowId,
    left: 20,
    top: 30,
    width: 720,
  });

  await controller.summon(workArea, "display-1");

  assert.deepEqual(chrome.calls.updateWindow.findLast(({ id }) => id === first.playhouseWindowId)?.options, {
    focused: true,
  });
  assert.deepEqual(
    chrome.calls.updateWindow.filter(({ id, options }) => id === first.playhouseWindowId && options.width).at(-1)?.options,
    { focused: false, height: 820, left: 20, state: "normal", top: 30, width: 720 },
  );
});
