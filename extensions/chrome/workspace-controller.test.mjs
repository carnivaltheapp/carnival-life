import assert from "node:assert/strict";
import test from "node:test";

import {
  CarnivalWorkspaceController,
  DEFAULT_CONTEXT_URL,
  PLAYHOUSE_URL,
  defaultWorkspaceLayout,
  effectiveRetractThreshold,
  isAllowedContextUrl,
  restoredWorkspaceLayout,
} from "./workspace-controller.js";
import { defaultAuxTabs, defaultPlayhouseTabs } from "./workspace-tabs.js";

function fakeChrome() {
  let state = {};
  let nextWindowId = 1;
  let nextTabId = 10;
  const windows = new Map();
  const tabs = new Map();
  const calls = { createTab: [], createWindow: [], updateTab: [], updateWindow: [] };

  function windowTabs(windowId) {
    return [...tabs.values()]
      .filter((tab) => tab.windowId === windowId)
      .sort((left, right) => left.index - right.index);
  }

  function syncWindowTabs(windowId) {
    const ordered = windowTabs(windowId).map((tab, index) => ({ ...tab, index }));
    for (const tab of ordered) tabs.set(tab.id, tab);
    const window = windows.get(windowId);
    if (window) windows.set(windowId, { ...window, tabs: ordered });
    return ordered;
  }

  function addTab(windowId, url, options = {}) {
    const existing = windowTabs(windowId);
    const active = options.active ?? existing.length === 0;
    if (active) {
      for (const tab of existing) tabs.set(tab.id, { ...tab, active: false });
    }
    const tab = {
      active,
      id: nextTabId++,
      index: existing.length,
      pinned: options.pinned ?? false,
      url,
      windowId,
    };
    tabs.set(tab.id, tab);
    syncWindowTabs(windowId);
    return tabs.get(tab.id);
  }

  return {
    activateTab(id) {
      const selected = tabs.get(id);
      for (const tab of windowTabs(selected.windowId)) {
        tabs.set(tab.id, { ...tab, active: tab.id === id });
      }
      syncWindowTabs(selected.windowId);
    },
    addTab,
    calls,
    closeTab(id) {
      const removed = tabs.get(id);
      tabs.delete(id);
      const remaining = syncWindowTabs(removed.windowId);
      if (removed.active && remaining[0]) {
        tabs.set(remaining[0].id, { ...remaining[0], active: true });
        syncWindowTabs(removed.windowId);
      }
    },
    closeWindow(id) {
      windows.delete(id);
      for (const tab of windowTabs(id)) tabs.delete(tab.id);
    },
    getTab(id) { return tabs.get(id); },
    getTabs(id) { return windowTabs(id); },
    getWindow(id) { return windows.get(id); },
    moveTab(id, index) {
      const moved = tabs.get(id);
      const ordered = windowTabs(moved.windowId).filter((tab) => tab.id !== id);
      ordered.splice(index, 0, moved);
      ordered.forEach((tab, tabIndex) => tabs.set(tab.id, { ...tab, index: tabIndex }));
      syncWindowTabs(moved.windowId);
    },
    resizeWindow(id, bounds) { windows.set(id, { ...windows.get(id), ...bounds }); },
    setWorkspaceState(value) { state = { carnivalDesktopWorkspace: value }; },
    storage: {
      local: {
        async get() { return state; },
        async set(value) { state = value; },
      },
    },
    tabs: {
      async create(options) {
        calls.createTab.push(options);
        return addTab(options.windowId, options.url, options);
      },
      async get(id) {
        if (!tabs.has(id)) throw new Error("missing tab");
        return tabs.get(id);
      },
      async query({ url, windowId } = {}) {
        let matches = [...tabs.values()];
        if (Number.isInteger(windowId)) {
          matches = matches.filter((tab) => tab.windowId === windowId);
        }
        if (!url) return matches;
        const prefix = url.replace("*", "");
        return matches.filter((tab) => tab.url.startsWith(prefix));
      },
      async update(id, options) {
        calls.updateTab.push({ id, options });
        const current = tabs.get(id);
        if (options.active) {
          for (const tab of windowTabs(current.windowId)) {
            tabs.set(tab.id, { ...tab, active: tab.id === id });
          }
        }
        const tab = { ...tabs.get(id), ...options };
        tabs.set(id, tab);
        syncWindowTabs(tab.windowId);
        return tab;
      },
    },
    windows: {
      async create(options) {
        calls.createWindow.push(options);
        const id = nextWindowId++;
        const window = { ...options, id, tabs: [] };
        windows.set(window.id, window);
        const urls = Array.isArray(options.url) ? options.url : [options.url];
        for (const [index, url] of urls.entries()) addTab(id, url, { active: index === 0 });
        return windows.get(id);
      },
      async get(id) {
        if (!windows.has(id)) throw new Error("missing window");
        syncWindowTabs(id);
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

function controller(chrome) {
  return new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
  });
}

test("default workspace is a left PlayHouse 60/40 split across the monitor work area", () => {
  assert.deepEqual(defaultWorkspaceLayout({ height: 1000, left: 100, top: 20, width: 2000 }), {
    context: { height: 1000, left: 1240, top: 20, width: 760 },
    playhouse: { height: 1000, left: 100, top: 20, width: 1140 },
  });
});

test("saved independent widths, positions, and gap restore at full monitor height", () => {
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  assert.deepEqual(restoredWorkspaceLayout({
    contextBounds: { height: 800, left: 1000, top: 30, width: 500 },
    layoutVersion: 2,
    playhouseBounds: { height: 800, left: 50, top: 30, width: 800 },
    workArea,
  }, workArea), {
    context: { height: 900, left: 1000, top: 0, width: 500 },
    playhouse: { height: 900, left: 50, top: 0, width: 800 },
  });
});

test("monitor change preserves independent offsets and widths while adapting height", () => {
  const priorWorkArea = { height: 900, left: 0, top: 0, width: 1600 };
  const workArea = { height: 1000, left: 100, top: 20, width: 2000 };
  const restored = restoredWorkspaceLayout({
    contextBounds: { height: 800, left: 900, top: 30, width: 600 },
    layoutVersion: 2,
    playhouseBounds: { height: 800, left: 50, top: 30, width: 700 },
    workArea: priorWorkArea,
  }, workArea);

  assert.deepEqual(restored, {
    context: { height: 1000, left: 1000, top: 20, width: 600 },
    playhouse: { height: 1000, left: 150, top: 20, width: 700 },
  });
});

test("smaller monitors clamp each window only as much as needed to stay reachable", () => {
  const restored = restoredWorkspaceLayout({
    contextBounds: { height: 900, left: 1200, top: 0, width: 600 },
    layoutVersion: 2,
    playhouseBounds: { height: 900, left: 100, top: 0, width: 1400 },
    workArea: { height: 900, left: 0, top: 0, width: 2000 },
  }, { height: 700, left: 100, top: 20, width: 1200 });

  assert.deepEqual(restored, {
    context: { height: 700, left: 700, top: 20, width: 600 },
    playhouse: { height: 700, left: 100, top: 20, width: 1200 },
  });
});

test("retract threshold uses 100px when available and monitor-edge fallback otherwise", () => {
  assert.equal(effectiveRetractThreshold(1400, 1800), 1500);
  assert.equal(effectiveRetractThreshold(1200, 1800), 1300);
  assert.equal(effectiveRetractThreshold(1920, 1920), 1919);
});

test("context routing accepts browser URLs and rejects privileged schemes", () => {
  assert.equal(isAllowedContextUrl("https://mail.google.com/mail/u/0/#inbox"), true);
  assert.equal(isAllowedContextUrl("http://localhost:3002"), true);
  assert.equal(isAllowedContextUrl("file:///private/data"), false);
  assert.equal(isAllowedContextUrl("javascript:alert(1)"), false);
});

test("legacy persisted tabs and role-specific bounds migrate into explicit PH/Aux sessions", async () => {
  const chrome = fakeChrome();
  chrome.setWorkspaceState({
    contextTabs: defaultAuxTabs(),
    layoutVersion: 2,
    playhouseTabs: {
      activeIndex: 0,
      tabs: [{ pinned: false, role: "playhouse", url: PLAYHOUSE_URL }],
    },
    savedVisibleBounds: {
      context: { height: 700, left: 900, top: 10, width: 650 },
      playhouse: { height: 700, left: 120, top: 10, width: 700 },
    },
  });

  const migrated = await controller(chrome).state();

  assert.deepEqual(migrated.phSession, {
    geometry: { left: 120, width: 700 },
    tabs: defaultPlayhouseTabs(PLAYHOUSE_URL),
  });
  assert.deepEqual(migrated.auxSession, {
    geometry: { left: 900, width: 650 },
    tabs: defaultAuxTabs(),
  });
});

test("repeated summons reuse both identified Chrome windows", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };

  const first = await workspace.summon(workArea, "display-1");
  const second = await workspace.summon(workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 2);
  assert.equal(second.playhouseWindowId, first.playhouseWindowId);
  assert.equal(second.contextWindowId, first.contextWindowId);
  assert.deepEqual(chrome.calls.createWindow[1].url, [
    DEFAULT_CONTEXT_URL,
    "https://mail.google.com/mail/u/0/#inbox",
    "https://www.google.com/",
  ]);
});

test("opening a URL in Aux reuses its designated tab without changing PlayHouse", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  const playhouseBefore = { ...chrome.getWindow(initial.playhouseWindowId) };
  chrome.calls.createWindow.length = 0;
  chrome.calls.updateWindow.length = 0;

  await workspace.openCarnivalContext("https://example.com/play", workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 0);
  assert.equal(chrome.calls.createTab.length, 0);
  assert.deepEqual(chrome.calls.updateTab.at(-1)?.options, {
    active: true,
    url: "https://example.com/play",
  });
  assert.deepEqual(chrome.getWindow(initial.playhouseWindowId), playhouseBefore);
  assert.equal(
    chrome.calls.updateWindow.some(({ id }) => id === initial.playhouseWindowId),
    false,
  );
  await assert.rejects(
    workspace.openCarnivalContext("chrome://settings", workArea, "display-1"),
    /HTTP or HTTPS/,
  );
});

test("repeated Email and Chrome routing reuse their durable Aux role tabs without growth", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");

  await workspace.openCarnivalContext("https://mail.google.com/mail/u/0/#all/thread-1", workArea, "display-1");
  await workspace.openCarnivalContext("https://example.com/context", workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 2);
  assert.equal(chrome.calls.createTab.length, 0);
  assert.equal(chrome.getTab(initial.contextRoleTabIds.gmail).url, "https://mail.google.com/mail/u/0/#all/thread-1");
  assert.equal(chrome.getTab(initial.contextRoleTabIds.misc).url, "https://example.com/context");
  assert.equal(chrome.getTab(initial.playhouseTabId).url, PLAYHOUSE_URL);
});

test("Aux tab order, active tab, pins, roles, and user tabs restore after window close", async () => {
  const chrome = fakeChrome();
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await controller(chrome).summon(workArea, "display-1");
  const userTab = chrome.addTab(first.contextWindowId, "https://docs.google.com/document/d/example", {
    active: true,
  });
  chrome.moveTab(userTab.id, 1);
  chrome.moveTab(first.contextRoleTabIds.gmail, 0);
  await chrome.tabs.update(userTab.id, { pinned: true });
  await controller(chrome).rememberWorkspaceTabs(first.contextWindowId);
  chrome.closeWindow(first.contextWindowId);

  const restarted = controller(chrome);
  await restarted.openCarnivalContext(
    "https://mail.google.com/mail/u/0/#all/restored-thread",
    workArea,
    "display-1",
  );
  const restored = await restarted.state();
  const restoredTabs = chrome.getTabs(restored.contextWindowId);

  assert.deepEqual(restoredTabs.map(({ url }) => url), [
    "https://mail.google.com/mail/u/0/#all/restored-thread",
    DEFAULT_CONTEXT_URL,
    "https://docs.google.com/document/d/example",
    "https://www.google.com/",
  ]);
  assert.equal(restoredTabs[0].active, true);
  assert.equal(restoredTabs[2].pinned, true);
  assert.equal(chrome.getTab(restored.contextRoleTabIds.calendar).url, DEFAULT_CONTEXT_URL);
  assert.equal(chrome.getTab(restored.contextRoleTabIds.gmail).url, "https://mail.google.com/mail/u/0/#all/restored-thread");
  assert.equal(chrome.getTab(restored.contextRoleTabIds.misc).url, "https://www.google.com/");
});

test("PlayHouse user tabs and active tab restore after controller restart", async () => {
  const chrome = fakeChrome();
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await controller(chrome).summon(workArea, "display-1");
  chrome.addTab(first.playhouseWindowId, "https://example.com/reference", { active: true });
  await controller(chrome).rememberWorkspaceTabs(first.playhouseWindowId);
  chrome.closeWindow(first.playhouseWindowId);

  const restored = await controller(chrome).summon(workArea, "display-1");

  assert.deepEqual(chrome.getTabs(restored.playhouseWindowId).map(({ active, url }) => ({ active, url })), [
    { active: false, url: PLAYHOUSE_URL },
    { active: true, url: "https://example.com/reference" },
  ]);
  assert.equal(chrome.getTab(restored.playhouseTabId).url, PLAYHOUSE_URL);
});

test("a deliberately closed Gmail role is recreated only when Gmail routing needs it", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  chrome.closeTab(initial.contextRoleTabIds.gmail);
  await workspace.rememberWorkspaceTabs(initial.contextWindowId);
  const countAfterClose = chrome.getTabs(initial.contextWindowId).length;

  await workspace.summon(workArea, "display-1");
  assert.equal(chrome.getTabs(initial.contextWindowId).length, countAfterClose);

  await workspace.openCarnivalContext(
    "https://mail.google.com/mail/u/0/#all/thread-restored",
    workArea,
    "display-1",
  );
  const state = await workspace.state();
  assert.equal(chrome.getTabs(initial.contextWindowId).length, countAfterClose + 1);
  assert.equal(
    chrome.getTab(state.contextRoleTabIds.gmail).url,
    "https://mail.google.com/mail/u/0/#all/thread-restored",
  );
});

test("opening in Aux restores a minimized or offscreen Aux and focuses it", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(initial.contextWindowId, { left: -2000, state: "minimized" });
  chrome.calls.updateWindow.length = 0;

  await workspace.openCarnivalContext("https://example.com/restored", workArea, "display-1");

  assert.deepEqual(chrome.calls.updateWindow[0], {
    id: initial.contextWindowId,
    options: { ...defaultWorkspaceLayout(workArea).context, focused: false, state: "normal" },
  });
  assert.deepEqual(chrome.calls.updateWindow.at(-1), {
    id: initial.contextWindowId,
    options: { focused: true },
  });
});

test("opening in Aux recreates only a closed Aux at its saved geometry", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  const playhouseBefore = { ...chrome.getWindow(initial.playhouseWindowId) };
  chrome.closeWindow(initial.contextWindowId);
  chrome.calls.createWindow.length = 0;
  chrome.calls.updateWindow.length = 0;

  await workspace.openCarnivalContext("https://example.com/recreated", workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 1);
  assert.deepEqual(chrome.calls.createWindow[0], {
    ...defaultWorkspaceLayout(workArea).context,
    focused: false,
    type: "normal",
    url: [
      DEFAULT_CONTEXT_URL,
      "https://mail.google.com/mail/u/0/#inbox",
      "https://www.google.com/",
    ],
  });
  assert.deepEqual(chrome.getWindow(initial.playhouseWindowId), playhouseBefore);
  assert.equal(
    chrome.calls.updateWindow.some(({ id }) => id === initial.playhouseWindowId),
    false,
  );
});

test("a missing workspace side is repaired without duplicating the surviving window", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await workspace.summon(workArea, "display-1");
  chrome.closeWindow(first.contextWindowId);

  const repaired = await workspace.summon(workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 3);
  assert.equal(repaired.playhouseWindowId, first.playhouseWindowId);
  assert.notEqual(repaired.contextWindowId, first.contextWindowId);
});

test("logical OPEN with both identified windows visible is functionally open", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");

  const actual = await workspace.reconcileWorkspaceState(workArea);

  assert.equal(actual.actuallyOpen, true);
  assert.equal(actual.state.playhouseWindowId, opened.playhouseWindowId);
  assert.equal(actual.state.contextWindowId, opened.contextWindowId);
});

test("stale OPEN state with missing PlayHouse is reconciled and recreates only PlayHouse", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await workspace.summon(workArea, "display-1");
  chrome.closeWindow(first.playhouseWindowId);

  const actual = await workspace.reconcileWorkspaceState(workArea);
  chrome.calls.updateWindow.length = 0;
  const repaired = await workspace.summon(workArea, "display-1");

  assert.equal(actual.actuallyOpen, false);
  assert.equal(actual.state.playhouseWindowId, null);
  assert.equal(chrome.calls.createWindow.length, 3);
  assert.notEqual(repaired.playhouseWindowId, first.playhouseWindowId);
  assert.equal(repaired.contextWindowId, first.contextWindowId);
  assert.equal(chrome.calls.updateWindow.some(({ id, options }) => (
    id === first.contextWindowId && (options.left !== undefined || options.width !== undefined)
  )), false);
});

test("stale OPEN state with missing Aux is reconciled and recreates only Aux", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await workspace.summon(workArea, "display-1");
  chrome.closeWindow(first.contextWindowId);

  const actual = await workspace.reconcileWorkspaceState(workArea);
  chrome.calls.updateWindow.length = 0;
  const repaired = await workspace.summon(workArea, "display-1");

  assert.equal(actual.actuallyOpen, false);
  assert.equal(actual.state.contextWindowId, null);
  assert.equal(chrome.calls.createWindow.length, 3);
  assert.equal(repaired.playhouseWindowId, first.playhouseWindowId);
  assert.notEqual(repaired.contextWindowId, first.contextWindowId);
  assert.equal(chrome.calls.updateWindow.some(({ id, options }) => (
    id === first.playhouseWindowId && (options.left !== undefined || options.width !== undefined)
  )), false);
});

test("stale OPEN state with both windows missing recreates both", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await workspace.summon(workArea, "display-1");
  chrome.closeWindow(first.playhouseWindowId);
  chrome.closeWindow(first.contextWindowId);

  await workspace.reconcileWorkspaceState(workArea);
  const repaired = await workspace.summon(workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 4);
  assert.notEqual(repaired.playhouseWindowId, first.playhouseWindowId);
  assert.notEqual(repaired.contextWindowId, first.contextWindowId);
});

test("stale OPEN state with offscreen windows runs the normal opening path", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { info() {}, warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(first.playhouseWindowId, { left: -1600 });
  chrome.resizeWindow(first.contextWindowId, { left: -700 });

  const actual = await workspace.reconcileWorkspaceState(workArea);
  const reopened = await workspace.summon(workArea, "display-1");

  assert.equal(actual.actuallyOpen, false);
  assert.equal(actual.state.drawerState, "retracted");
  assert.equal(reopened.drawerState, "open");
  assert.equal(animations.length, 2);
});

test("stale OPEN state with minimized windows restores both", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(first.playhouseWindowId, { state: "minimized" });
  chrome.resizeWindow(first.contextWindowId, { state: "minimized" });

  const actual = await workspace.reconcileWorkspaceState(workArea);
  await workspace.summon(workArea, "display-1");

  assert.equal(actual.actuallyOpen, false);
  assert.equal(chrome.calls.updateWindow.some(({ id, options }) =>
    id === first.playhouseWindowId && options.state === "normal"), true);
  assert.equal(chrome.calls.updateWindow.some(({ id, options }) =>
    id === first.contextWindowId && options.state === "normal"), true);
});

test("manual window closes invalidate live identities and eventually retract state", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await workspace.summon(workArea, "display-1");

  const degraded = await workspace.handleWindowClosed(first.playhouseWindowId);
  const retracted = await workspace.handleWindowClosed(first.contextWindowId);

  assert.equal(degraded.drawerState, "degraded");
  assert.equal(degraded.playhouseWindowId, null);
  assert.equal(retracted.drawerState, "retracted");
  assert.equal(retracted.contextWindowId, null);
});

test("PlayHouse resize persists independently without changing Aux", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(opened.playhouseWindowId, { width: 700 });

  const saved = await workspace.rememberVisibleBounds();

  assert.equal(saved.playhouseBounds.width, 700);
  assert.deepEqual(saved.contextBounds, opened.contextBounds);
});

test("Aux resize persists independently without changing PlayHouse", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(opened.contextWindowId, { width: 450 });

  const saved = await workspace.rememberVisibleBounds();

  assert.equal(saved.contextBounds.width, 450);
  assert.deepEqual(saved.playhouseBounds, opened.playhouseBounds);
});

test("settled geometry keeps horizontal choices and restores full monitor height", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 20, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(opened.playhouseWindowId, { height: 600, left: 40, top: 100, width: 700 });
  chrome.resizeWindow(opened.contextWindowId, { height: 700, left: 850, top: 80, width: 500 });

  const saved = await workspace.rememberVisibleBounds();

  assert.deepEqual(saved.phSession.geometry, { left: 40, width: 700 });
  assert.deepEqual(saved.auxSession.geometry, { left: 850, width: 500 });
  assert.deepEqual(chrome.calls.updateWindow.slice(-2).map(({ id, options }) => ({ id, options })), [
    {
      id: opened.playhouseWindowId,
      options: { focused: false, height: 900, state: "normal", top: 20 },
    },
    {
      id: opened.contextWindowId,
      options: { focused: false, height: 900, state: "normal", top: 20 },
    },
  ]);
});

test("independent movement and a 100px gap persist through retract and reopen", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1800 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(opened.playhouseWindowId, { left: 50, width: 700 });
  chrome.resizeWindow(opened.contextWindowId, { left: 850, width: 600 });
  await workspace.rememberVisibleBounds();

  await workspace.retract();
  await workspace.summon(workArea, "display-1");

  assert.deepEqual(animations.at(-1).playhouse.to, {
    height: 900, left: 50, top: 0, width: 700,
  });
  assert.deepEqual(animations.at(-1).context.to, {
    height: 900, left: 850, top: 0, width: 600,
  });
  assert.equal(animations.at(-1).context.to.left -
    (animations.at(-1).playhouse.to.left + animations.at(-1).playhouse.to.width), 100);
});

test("both closed workspace windows are recreated with saved geometry and context", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(first.playhouseWindowId, {
    height: 900,
    left: 0,
    top: 0,
    width: 700,
  });
  chrome.resizeWindow(first.contextWindowId, {
    height: 900,
    left: 700,
    top: 0,
    width: 730,
  });
  await workspace.rememberVisibleBounds();
  await workspace.openCarnivalContext("https://calendar.google.com/calendar/u/0/r/week", workArea, "display-1");
  chrome.closeWindow(first.playhouseWindowId);
  chrome.closeWindow(first.contextWindowId);

  const recreated = await workspace.summon(workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 4);
  assert.notEqual(recreated.playhouseWindowId, first.playhouseWindowId);
  assert.notEqual(recreated.contextWindowId, first.contextWindowId);
  assert.deepEqual(chrome.calls.createWindow.at(-1).url, [
    DEFAULT_CONTEXT_URL,
    "https://mail.google.com/mail/u/0/#inbox",
    "https://calendar.google.com/calendar/u/0/r/week",
  ]);
  assert.deepEqual(animations.at(-1).playhouse.to, {
    height: 900,
    left: 0,
    top: 0,
    width: 700,
  });
  assert.deepEqual(animations.at(-1).context.to, {
    height: 900,
    left: 700,
    top: 0,
    width: 730,
  });
  assert.equal(chrome.calls.createWindow.some(({ left }) => left < workArea.left), false);
});

test("concurrent PH and Aux close events clear only live identities and retain both sessions", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const before = await workspace.state();

  chrome.closeWindow(opened.playhouseWindowId);
  chrome.closeWindow(opened.contextWindowId);
  await Promise.all([
    workspace.handleWindowClosed(opened.playhouseWindowId),
    workspace.handleWindowClosed(opened.contextWindowId),
  ]);
  const after = await workspace.state();

  assert.equal(after.phWindowId, null);
  assert.equal(after.auxWindowId, null);
  assert.equal(after.drawerState, "retracted");
  assert.deepEqual(after.phSession, before.phSession);
  assert.deepEqual(after.auxSession, before.auxSession);
});

test("role sessions restore user tabs, active tabs, and unswapped geometry after both windows close", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1800 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.addTab(opened.playhouseWindowId, "https://example.com/a");
  chrome.addTab(opened.playhouseWindowId, "https://example.com/b", { active: true });
  chrome.addTab(opened.contextWindowId, "https://youtube.com/", { active: true });
  await workspace.rememberWorkspaceTabs(opened.playhouseWindowId);
  await workspace.rememberWorkspaceTabs(opened.contextWindowId);
  chrome.resizeWindow(opened.playhouseWindowId, { left: 120, width: 700 });
  chrome.resizeWindow(opened.contextWindowId, { left: 900, width: 650 });
  await workspace.rememberVisibleBounds();
  chrome.closeWindow(opened.playhouseWindowId);
  chrome.closeWindow(opened.contextWindowId);
  await Promise.all([
    workspace.handleWindowClosed(opened.playhouseWindowId),
    workspace.handleWindowClosed(opened.contextWindowId),
  ]);

  const restored = await controller(chrome).summon(workArea, "display-1");
  const phTabs = chrome.getTabs(restored.phWindowId);
  const auxTabs = chrome.getTabs(restored.auxWindowId);

  assert.deepEqual(phTabs.map(({ url }) => url), [PLAYHOUSE_URL, "https://example.com/a", "https://example.com/b"]);
  assert.equal(phTabs[2].active, true);
  assert.deepEqual(auxTabs.map(({ url }) => url), [
    DEFAULT_CONTEXT_URL,
    "https://mail.google.com/mail/u/0/#inbox",
    "https://www.google.com/",
    "https://youtube.com/",
  ]);
  assert.equal(auxTabs[3].active, true);
  assert.deepEqual(
    { left: chrome.getWindow(restored.phWindowId).left, width: chrome.getWindow(restored.phWindowId).width },
    { left: 120, width: 700 },
  );
  assert.deepEqual(
    { left: chrome.getWindow(restored.auxWindowId).left, width: chrome.getWindow(restored.auxWindowId).width },
    { left: 900, width: 650 },
  );
  assert.equal(chrome.getTab(restored.phPrimaryTabId).url, PLAYHOUSE_URL);
  assert.equal(chrome.getTab(restored.auxRoleTabIds.gmail).url, "https://mail.google.com/mail/u/0/#inbox");
});

test("a PlayHouse URL in Aux is never adopted as the PH window", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.addTab(opened.contextWindowId, `${PLAYHOUSE_URL}?reference=aux`);
  await workspace.rememberWorkspaceTabs(opened.contextWindowId);
  chrome.closeWindow(opened.playhouseWindowId);
  await workspace.handleWindowClosed(opened.playhouseWindowId);

  const restored = await workspace.summon(workArea, "display-1");

  assert.notEqual(restored.phWindowId, opened.contextWindowId);
  assert.equal(restored.auxWindowId, opened.contextWindowId);
  assert.equal(chrome.getTab(restored.phPrimaryTabId).windowId, restored.phWindowId);
});

test("explicit role restoration is independent of PH/Aux creation order", async () => {
  const bounds = {
    aux: { height: 900, left: 900, top: 0, width: 650 },
    ph: { height: 900, left: 120, top: 0, width: 700 },
  };
  for (const order of ["ph-first", "aux-first"]) {
    const chrome = fakeChrome();
    const workspace = controller(chrome);
    const created = {};
    const createPh = async () => {
      created.ph = await workspace.createWindowFromTabs(
        bounds.ph,
        defaultPlayhouseTabs(PLAYHOUSE_URL),
        "playhouse",
      );
    };
    const createAux = async () => {
      created.aux = await workspace.createWindowFromTabs(bounds.aux, defaultAuxTabs(), "context");
    };
    if (order === "ph-first") {
      await createPh();
      await createAux();
    } else {
      await createAux();
      await createPh();
    }
    assert.equal(created.ph.window.left, 120);
    assert.equal(created.ph.window.width, 700);
    assert.equal(created.aux.window.left, 900);
    assert.equal(created.aux.window.width, 650);
    assert.equal(chrome.getTab(created.ph.roleTabIds["ph-primary"]).url, PLAYHOUSE_URL);
    assert.equal(chrome.getTab(created.aux.roleTabIds.gmail).url, "https://mail.google.com/mail/u/0/#inbox");
  }
});

test("user-resized bounds are restored on the same monitor", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(first.playhouseWindowId, {
    height: 900,
    left: 0,
    top: 0,
    width: 720,
  });
  chrome.resizeWindow(first.contextWindowId, {
    height: 900,
    left: 720,
    top: 0,
    width: 680,
  });
  await workspace.rememberVisibleBounds();

  await workspace.summon(workArea, "display-1");

  assert.deepEqual(chrome.calls.updateWindow.findLast(({ id }) => id === first.playhouseWindowId)?.options, {
    focused: true,
  });
  assert.deepEqual(
    chrome.calls.updateWindow.filter(({ id, options }) => id === first.playhouseWindowId && options.width).at(-1)?.options,
    { focused: false, height: 900, left: 0, state: "normal", top: 0, width: 720 },
  );
});

test("saved user widths survive retract, reopen, and controller restart", async () => {
  const chrome = fakeChrome();
  const animations = [];
  let workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(first.playhouseWindowId, {
    height: 900,
    left: 0,
    top: 0,
    width: 700,
  });
  chrome.resizeWindow(first.contextWindowId, {
    height: 900,
    left: 700,
    top: 0,
    width: 730,
  });
  await workspace.rememberVisibleBounds();
  const resizedState = await workspace.state();
  assert.equal(resizedState.contextBounds.left + resizedState.contextBounds.width, 1430);
  assert.equal(effectiveRetractThreshold(1430, 1600), 1530);
  await workspace.retract();

  workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
  });
  await workspace.summon(workArea, "display-1");

  assert.deepEqual(animations.at(-1).playhouse.to, {
    height: 900,
    left: 0,
    top: 0,
    width: 700,
  });
  assert.deepEqual(animations.at(-1).context.to, {
    height: 900,
    left: 700,
    top: 0,
    width: 730,
  });
});

test("retract captures the last visible role-specific horizontal geometry before animation", async () => {
  const chrome = fakeChrome();
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async () => true,
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1800 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(opened.phWindowId, { left: 75, width: 760 });
  chrome.resizeWindow(opened.auxWindowId, { left: 910, width: 620 });

  const retracted = await workspace.retract();

  assert.deepEqual(retracted.phSession.geometry, { left: 75, width: 760 });
  assert.deepEqual(retracted.auxSession.geometry, { left: 910, width: 620 });
});

test("native offscreen bounds are not persisted over the saved visible geometry", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const visible = await workspace.state();
  await workspace.save({ ...visible, drawerState: "retracted" });

  chrome.resizeWindow(opened.playhouseWindowId, {
    ...visible.playhouseBounds,
    left: -1600,
  });
  const result = await workspace.rememberVisibleBounds();

  assert.equal(result, null);
  assert.deepEqual((await workspace.state()).playhouseBounds, visible.playhouseBounds);
});

test("native open and retract animations move both windows with one shared offset and reuse them", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const createdCount = chrome.calls.createWindow.length;

  const retracted = await workspace.retract();
  const reopened = await workspace.summon(workArea, "display-1");

  assert.equal(retracted.drawerState, "retracted");
  assert.equal(reopened.drawerState, "open");
  assert.equal(reopened.playhouseWindowId, opened.playhouseWindowId);
  assert.equal(reopened.contextWindowId, opened.contextWindowId);
  assert.equal(chrome.calls.createWindow.length, createdCount);

  assert.equal(animations.length, 3);
  assert.equal(animations[1].context.from.left - animations[1].playhouse.from.left, 900);
  assert.equal(animations[2].context.from.left - animations[2].playhouse.from.left, 900);
});

test("an open workspace uses native foreground activation without changing bounds", async () => {
  const chrome = fakeChrome();
  const activations = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    nativeActivate: async (bounds) => {
      activations.push(bounds);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.calls.updateWindow.length = 0;

  await workspace.activate();

  assert.deepEqual(activations, [{
    context: { height: 900, left: 900, top: 0, width: 600 },
    playhouse: { height: 900, left: 0, top: 0, width: 900 },
  }]);
  assert.equal(chrome.calls.updateWindow.length, 0);
  assert.equal((await workspace.state()).playhouseWindowId, opened.playhouseWindowId);
});

test("Windows native animation receives the same paired geometry for summon and retract", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };

  await workspace.summon(workArea, "display-1");
  await workspace.retract();

  assert.equal(animations.length, 2);
  assert.equal(animations[0].durationMs, 450);
  assert.equal(animations[0].easing, "out");
  assert.deepEqual(animations[0].playhouse.current, { height: 900, left: 0, top: 0, width: 900 });
  assert.deepEqual(animations[0].playhouse.from, { height: 900, left: -1600, top: 0, width: 900 });
  assert.deepEqual(animations[0].playhouse.to, { height: 900, left: 0, top: 0, width: 900 });
  assert.equal(animations[0].context.from.left - animations[0].playhouse.from.left, 900);
  assert.equal(animations[1].easing, "in");
  assert.equal(animations[1].durationMs, 400);
  assert.deepEqual(animations[1].playhouse.from, animations[0].playhouse.to);
  assert.deepEqual(animations[1].playhouse.to, animations[0].playhouse.from);
  assert.equal(chrome.calls.updateWindow.filter(({ options }) => (
    Object.keys(options).length === 1 && Number.isInteger(options.left)
  )).length, 0);
});

test("retracted native summon never sends offscreen bounds through the Chrome windows API", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };

  await workspace.summon(workArea, "display-1");
  await workspace.retract();
  chrome.calls.updateWindow.length = 0;
  const reopened = await workspace.summon(workArea, "display-1");

  assert.equal(reopened.drawerState, "open");
  assert.equal(animations.at(-1).easing, "out");
  assert.ok(animations.at(-1).playhouse.from.left < workArea.left);
  assert.equal(chrome.calls.updateWindow.some(({ options }) => options.left < workArea.left), false);
});

test("fresh windows use visible Chrome bounds before native animation handoff", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };

  await workspace.summon(workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 2);
  assert.equal(chrome.calls.createWindow.some(({ left }) => left < workArea.left), false);
  assert.equal(animations.length, 1);
  assert.ok(animations[0].playhouse.from.left < workArea.left);
});

test("native opening failure falls back to final visible bounds without offscreen Chrome updates", async () => {
  const chrome = fakeChrome();
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async () => false,
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };

  const opened = await workspace.summon(workArea, "display-1");

  assert.equal(opened.drawerState, "open");
  assert.equal(chrome.calls.updateWindow.some(({ options }) => options.left < workArea.left), false);
  assert.deepEqual(
    chrome.calls.updateWindow.filter(({ options }) => Number.isInteger(options.left)).map(({ options }) => options.left),
    [0, 900],
  );
});

test("native retraction failure leaves the visible workspace logically open", async () => {
  const chrome = fakeChrome();
  let fail = false;
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async () => !fail,
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  await workspace.summon(workArea, "display-1");
  fail = true;
  chrome.calls.updateWindow.length = 0;

  const state = await workspace.retract();

  assert.equal(state.drawerState, "open");
  assert.equal(chrome.calls.updateWindow.some(({ options }) => Number.isInteger(options.left)), false);
});
