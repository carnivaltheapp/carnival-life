import assert from "node:assert/strict";
import test from "node:test";

import {
  CarnivalWorkspaceController,
  canonicalRetractedWorkspaceLayout,
  compareAnimationLanding,
  DEFAULT_CONTEXT_URL,
  PLAYHOUSE_URL,
  defaultWorkspaceLayout,
  effectiveRetractThreshold,
  getAnchoredPlayhouseGeometry,
  isAllowedContextUrl,
  restoredWorkspaceLayout,
} from "./workspace-controller.js";
import { createWorkspaceActions } from "./workspace-summon.js";
import {
  AUX_HOT_TAB_ORDER,
  AUX_ROLE_URLS,
  createPhSessionDiagnosticTrail,
  defaultAuxTabs,
  defaultPlayhouseTabs,
} from "./workspace-tabs.js";

function fakeChrome() {
  let state = {};
  let nextWindowId = 1;
  let nextTabId = 10;
  const windows = new Map();
  const tabs = new Map();
  const calls = { createTab: [], createWindow: [], moveTab: [], updateTab: [], updateWindow: [] };
  function chromeEvent() {
    const listeners = new Set();
    return {
      addListener(listener) { listeners.add(listener); },
      emit(...args) { for (const listener of listeners) listener(...args); },
      get size() { return listeners.size; },
      removeListener(listener) { listeners.delete(listener); },
    };
  }
  const tabRemoved = chromeEvent();
  const tabUpdated = chromeEvent();
  const windowRemoved = chromeEvent();

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
      windowRemoved.emit(id);
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
    setTab(id, changes) {
      const tab = { ...tabs.get(id), ...changes };
      tabs.set(id, tab);
      syncWindowTabs(tab.windowId);
    },
    setWorkspaceState(value) { state = { carnivalDesktopWorkspace: value }; },
    storage: {
      local: {
        async get() { return state; },
        async set(value) { state = value; },
      },
    },
    tabs: {
      onRemoved: tabRemoved,
      onUpdated: tabUpdated,
      async create(options) {
        calls.createTab.push(options);
        return addTab(options.windowId, options.url, options);
      },
      async get(id) {
        if (!tabs.has(id)) throw new Error("missing tab");
        return tabs.get(id);
      },
      async move(ids, options) {
        const requested = Array.isArray(ids) ? ids : [ids];
        calls.moveTab.push({ ids: requested, options });
        const movedTabs = [];
        for (const id of requested) {
          const current = tabs.get(id);
          if (!current) throw new Error("missing tab");
          const oldWindowId = current.windowId;
          const windowId = Number.isInteger(options.windowId) ? options.windowId : oldWindowId;
          tabs.delete(id);
          syncWindowTabs(oldWindowId);
          const destination = windowTabs(windowId);
          const index = options.index < 0
            ? destination.length
            : Math.min(options.index, destination.length);
          destination.splice(index, 0, { ...current, windowId });
          destination.forEach((tab, tabIndex) => tabs.set(tab.id, { ...tab, index: tabIndex }));
          syncWindowTabs(windowId);
          movedTabs.push(tabs.get(id));
        }
        return Array.isArray(ids) ? movedTabs : movedTabs[0];
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
        tabUpdated.emit(id, options, tab);
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
      async getAll() {
        for (const id of windows.keys()) syncWindowTabs(id);
        return [...windows.values()];
      },
      onRemoved: windowRemoved,
      async update(id, options) {
        calls.updateWindow.push({ id, options });
        const window = { ...windows.get(id), ...options };
        windows.set(id, window);
        return window;
      },
    },
    get tabUpdatedListenerCount() { return tabUpdated.size; },
  };
}

function controller(chrome) {
  return new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
  });
}

function diagnosticController(chrome, options = {}) {
  const events = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    ...options,
    logger: {
      info(event, details) { events.push({ details, event }); },
      warn() {},
    },
  });
  return { events, workspace };
}

function phSessionDiagnosticController(chrome) {
  const records = [];
  const phSessionDiagnostics = createPhSessionDiagnosticTrail({
    async record(event, details) { records.push({ details, event }); },
  });
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    phSessionDiagnostics,
  });
  return { phSessionDiagnostics, records, workspace };
}

test("default workspace is a left PlayHouse 60/40 split across the monitor work area", () => {
  assert.deepEqual(defaultWorkspaceLayout({ height: 1000, left: 100, top: 20, width: 2000 }), {
    context: { height: 1000, left: 1240, top: 20, width: 760 },
    playhouse: { height: 1000, left: 100, top: 20, width: 1140 },
  });
});

test("saved widths restore while PlayHouse position is anchored", () => {
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  assert.deepEqual(restoredWorkspaceLayout({
    contextBounds: { height: 800, left: 1000, top: 30, width: 500 },
    layoutVersion: 2,
    playhouseBounds: { height: 800, left: 50, top: 30, width: 800 },
    workArea,
  }, workArea), {
    context: { height: 900, left: 1000, top: 0, width: 500 },
    playhouse: { height: 900, left: 0, top: 0, width: 800 },
  });
});

test("monitor change anchors PlayHouse and preserves Aux offset and both widths", () => {
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
    playhouse: { height: 1000, left: 100, top: 20, width: 700 },
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
    workArea: { height: 900, left: -1920, top: 0, width: 1600 },
  });

  const migrated = await controller(chrome).state();

  assert.deepEqual(migrated.phSession, {
    geometry: { left: -1920, width: 700 },
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
    "https://contacts.google.com/",
    "https://app.slack.com/",
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

test("repeated Google Contacts routing reuses its canonical Aux Hot Tab", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");

  await workspace.openCarnivalContext("https://contacts.google.com/person/c123", workArea, "display-1");
  const afterFirst = await workspace.state();
  await workspace.openCarnivalContext("https://contacts.google.com/person/c456", workArea, "display-1");
  const afterSecond = await workspace.state();

  assert.equal(chrome.calls.createTab.length, 0);
  assert.equal(afterFirst.contextRoleTabIds.contacts, afterSecond.contextRoleTabIds.contacts);
  assert.equal(chrome.getTab(afterSecond.contextRoleTabIds.contacts).url, "https://contacts.google.com/person/c456");
  assert.equal(chrome.getTabs(initial.contextWindowId).length, 5);
});

test("an extra Contacts tab is handed to Misc while the canonical Contacts Hot Tab routes", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  const contacts = chrome.addTab(
    initial.contextWindowId,
    "https://contacts.google.com/?hl=en&tab=CC#contacts",
  );

  await workspace.openCarnivalContext("https://contacts.google.com/person/c123", workArea, "display-1");
  const state = await workspace.state();

  assert.equal(chrome.calls.createTab.length, 0);
  assert.notEqual(state.contextRoleTabIds.contacts, contacts.id);
  assert.equal(chrome.getTab(state.contextRoleTabIds.contacts).url, "https://contacts.google.com/person/c123");
  assert.equal(chrome.getTab(contacts.id).windowId, state.miscWindowId);
});

test("multiple extra Contacts tabs move to Misc without replacing the canonical Hot Tab", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  const first = chrome.addTab(initial.contextWindowId, "https://contacts.google.com/person/first");
  const active = chrome.addTab(
    initial.contextWindowId,
    "https://contacts.google.com/u/0/person/active?hl=en",
    { active: true },
  );

  await workspace.openCarnivalContext("https://contacts.google.com/person/selected", workArea, "display-1");
  const state = await workspace.state();

  assert.equal(chrome.calls.createTab.length, 0);
  assert.notEqual(state.contextRoleTabIds.contacts, active.id);
  assert.equal(chrome.getTab(state.contextRoleTabIds.contacts).url, "https://contacts.google.com/person/selected");
  assert.equal(chrome.getTab(active.id).windowId, state.miscWindowId);
  assert.equal(chrome.getTab(first.id).windowId, state.miscWindowId);
  assert.equal(chrome.getTab(first.id).url, "https://contacts.google.com/person/first");
});

test("Google Contacts routing ignores unrelated Google and Gmail tabs", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  chrome.addTab(initial.contextWindowId, "https://google.com/search?q=contact");
  chrome.addTab(initial.contextWindowId, "https://gmail.google.com/");
  chrome.addTab(initial.contextWindowId, "https://mail.google.com/mail/u/0/#contacts");

  await workspace.openCarnivalContext("https://contacts.google.com/person/c123", workArea, "display-1");
  const state = await workspace.state();

  assert.equal(chrome.calls.createTab.length, 0);
  assert.equal(chrome.getTab(state.contextRoleTabIds.contacts).url, "https://contacts.google.com/person/c123");
});

test("Slack routing reuses its canonical Hot Tab without creating duplicates", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");

  await workspace.openCarnivalContext("https://app.slack.com/client/T1/C1", workArea, "display-1");
  const first = await workspace.state();
  await workspace.openCarnivalContext("https://carnival.slack.com/archives/C2", workArea, "display-1");
  const second = await workspace.state();

  assert.equal(chrome.calls.createTab.length, 0);
  assert.equal(first.contextRoleTabIds.slack, second.contextRoleTabIds.slack);
  assert.equal(chrome.getTab(second.contextRoleTabIds.slack).url, "https://carnival.slack.com/archives/C2");
  assert.equal(chrome.getTabs(initial.contextWindowId).length, 5);
});

test("an extra Slack tab moves to Misc while the canonical Slack Hot Tab routes", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  const slack = chrome.addTab(initial.contextWindowId, "https://app.slack.com/client/T1/OLD");

  await workspace.openCarnivalContext("https://app.slack.com/client/T1/NEW", workArea, "display-1");
  const state = await workspace.state();

  assert.equal(chrome.calls.createTab.length, 0);
  assert.notEqual(state.contextRoleTabIds.slack, slack.id);
  assert.equal(chrome.getTab(state.contextRoleTabIds.slack).url, "https://app.slack.com/client/T1/NEW");
  assert.equal(chrome.getTab(slack.id).windowId, state.miscWindowId);
});

test("an arbitrary Aux tab moves to persistent Misc without changing the five Hot Tabs", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const thresholdTransfers = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
    nativeTransferRightSurfaceOwner: async (transfer) => {
      thresholdTransfers.push({ ...transfer, updateCount: chrome.calls.updateWindow.length });
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await workspace.summon(workArea, "display-1");
  const playhouseBefore = { ...chrome.getWindow(first.playhouseWindowId) };
  const animationCount = animations.length;
  const userTab = chrome.addTab(first.contextWindowId, "https://docs.google.com/document/d/example", {
    active: true,
  });
  await chrome.tabs.update(userTab.id, { pinned: true });
  chrome.calls.updateWindow.length = 0;
  await workspace.reconcileAuxTabs(first.contextWindowId, { revealMisc: true });
  const handedOff = await workspace.state();
  assert.equal(handedOff.rightSurface, "misc");
  assert.equal(chrome.getTab(userTab.id).active, true);
  assert.equal(chrome.getWindow(handedOff.miscWindowId).state, "normal");
  assert.equal(chrome.getWindow(first.contextWindowId).state, "minimized");
  const miscActivateIndex = chrome.calls.updateWindow.findIndex(({ id, options }) => (
    id === handedOff.miscWindowId && options.focused === true
  ));
  const auxHideIndex = chrome.calls.updateWindow.findIndex(({ id, options }) => (
    id === first.contextWindowId && options.state === "minimized"
  ));
  assert.ok(miscActivateIndex >= 0 && miscActivateIndex < auxHideIndex);
  assert.equal(thresholdTransfers[0].surface, "misc");
  assert.ok(thresholdTransfers[0].updateCount <= auxHideIndex);
  assert.deepEqual(chrome.getWindow(first.playhouseWindowId), playhouseBefore);
  assert.equal(chrome.calls.updateWindow.some(({ id }) => id === first.playhouseWindowId), false);
  assert.equal(animations.length, animationCount);
  await workspace.rememberWorkspaceTabs(handedOff.miscWindowId);
  chrome.closeWindow(handedOff.miscWindowId);
  await workspace.handleWindowClosed(handedOff.miscWindowId);

  const restarted = controller(chrome);
  await restarted.switchRightSurface("misc", workArea);
  const restored = await restarted.state();
  const restoredTabs = chrome.getTabs(restored.miscWindowId);

  assert.equal(restoredTabs.some(({ url }) => url === "https://docs.google.com/document/d/example"), true);
  assert.equal(restoredTabs.find(({ url }) => url.includes("docs.google.com"))?.pinned, true);
  assert.deepEqual(chrome.getTabs(restored.auxWindowId).map(({ url }) => url),
    defaultAuxTabs().tabs.map(({ url }) => url));
});

test("Aux and Misc swap in one right slot without moving PlayHouse or animating", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const thresholdTransfers = [];
  let thresholdOwner = null;
  let simulatedRetracts = 0;
  let workspace;
  workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
    nativeTransferRightSurfaceOwner: async (transfer) => {
      thresholdTransfers.push({
        ...transfer,
        stateAtTransfer: (await workspace.state()).rightSurface,
        updateCount: chrome.calls.updateWindow.length,
      });
      thresholdOwner = transfer.incomingWindowId;
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  thresholdOwner = opened.auxWindowId;
  const updateWindow = chrome.windows.update.bind(chrome.windows);
  chrome.windows.update = async (id, options) => {
    if (options.state === "minimized" && id === thresholdOwner) simulatedRetracts += 1;
    return updateWindow(id, options);
  };
  const playhouseBefore = { ...chrome.getWindow(opened.phWindowId) };
  const auxBefore = { ...chrome.getWindow(opened.auxWindowId) };
  const rightRect = (({ height, left, top, width }) => ({ height, left, top, width }))(auxBefore);
  const animationCount = animations.length;
  chrome.calls.updateWindow.length = 0;

  const misc = await workspace.switchRightSurface("misc", workArea);
  const miscWindowId = misc.miscWindowId;
  assert.equal(misc.rightSurface, "misc");
  assert.equal(chrome.getWindow(opened.auxWindowId).state, "minimized");
  assert.deepEqual(
    (({ height, left, top, width }) => ({ height, left, top, width }))(chrome.getWindow(miscWindowId)),
    rightRect,
  );
  assert.deepEqual(chrome.getWindow(opened.phWindowId), playhouseBefore);
  const miscPlaceIndex = chrome.calls.updateWindow.findIndex(({ id, options }) => (
    id === miscWindowId && options.left === rightRect.left && options.width === rightRect.width
  ));
  const miscActivateIndex = chrome.calls.updateWindow.findIndex(({ id, options }) => (
    id === miscWindowId && options.focused === true && !Object.hasOwn(options, "left")
  ));
  const auxHideIndex = chrome.calls.updateWindow.findIndex(({ id, options }) => (
    id === opened.auxWindowId && options.state === "minimized"
  ));
  assert.ok(miscPlaceIndex >= 0 && miscPlaceIndex < miscActivateIndex && miscActivateIndex < auxHideIndex);
  assert.equal(thresholdTransfers[0].incomingWindowId, miscWindowId);
  assert.equal(thresholdTransfers[0].stateAtTransfer, "aux");
  assert.ok(thresholdTransfers[0].updateCount <= auxHideIndex);
  assert.equal(thresholdOwner, miscWindowId);
  assert.equal(simulatedRetracts, 0);
  assert.equal(chrome.calls.updateWindow.some(({ id }) => id === opened.phWindowId), false);

  chrome.calls.updateWindow.length = 0;
  const aux = await workspace.toggleRightSurface(workArea);
  assert.equal(aux.rightSurface, "aux");
  assert.equal(chrome.getWindow(miscWindowId).state, "minimized");
  assert.equal(chrome.getWindow(opened.auxWindowId).state, "normal");
  assert.deepEqual(
    (({ height, left, top, width }) => ({ height, left, top, width }))(chrome.getWindow(opened.auxWindowId)),
    rightRect,
  );
  assert.deepEqual(chrome.getWindow(opened.phWindowId), playhouseBefore);
  const auxPlaceIndex = chrome.calls.updateWindow.findIndex(({ id, options }) => (
    id === opened.auxWindowId && options.left === rightRect.left && options.width === rightRect.width
  ));
  const auxActivateIndex = chrome.calls.updateWindow.findIndex(({ id, options }) => (
    id === opened.auxWindowId && options.focused === true && !Object.hasOwn(options, "left")
  ));
  const miscHideIndex = chrome.calls.updateWindow.findIndex(({ id, options }) => (
    id === miscWindowId && options.state === "minimized"
  ));
  assert.ok(auxPlaceIndex >= 0 && auxPlaceIndex < auxActivateIndex && auxActivateIndex < miscHideIndex);
  assert.equal(thresholdTransfers[1].incomingWindowId, opened.auxWindowId);
  assert.equal(thresholdTransfers[1].stateAtTransfer, "misc");
  assert.ok(thresholdTransfers[1].updateCount <= miscHideIndex);
  assert.equal(thresholdOwner, opened.auxWindowId);
  assert.equal(simulatedRetracts, 0);
  assert.equal(chrome.calls.updateWindow.some(({ id }) => id === opened.phWindowId), false);
  assert.equal(animations.length, animationCount);
  assert.equal(chrome.calls.createWindow.length, 3);
  assert.equal((await controller(chrome).state()).rightSurface, "aux");
});

test("logical rightSurface alone determines toggle direction despite focus and minimized state", async () => {
  const chrome = fakeChrome();
  const requestedSurfaces = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeTransferRightSurfaceOwner: async ({ surface }) => {
      requestedSurfaces.push(surface);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const misc = await workspace.switchRightSurface("misc", workArea);
  chrome.resizeWindow(opened.auxWindowId, { focused: true, state: "normal" });
  chrome.resizeWindow(misc.miscWindowId, { focused: false, state: "normal" });

  const toggled = await workspace.toggleRightSurface(workArea);

  assert.deepEqual(requestedSurfaces, ["misc", "aux"]);
  assert.equal(toggled.rightSurface, "aux");
});

test("failed threshold transfer preserves the outgoing surface and releases the transition queue", async () => {
  const chrome = fakeChrome();
  let attempts = 0;
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeTransferRightSurfaceOwner: async () => ++attempts > 1,
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");

  await assert.rejects(workspace.switchRightSurface("misc", workArea), /transfer the drawer threshold/);
  assert.equal((await workspace.state()).rightSurface, "aux");
  assert.equal(chrome.getWindow(opened.auxWindowId).state, "normal");

  const recovered = await workspace.switchRightSurface("misc", workArea);
  assert.equal(recovered.rightSurface, "misc");
  assert.equal(chrome.getWindow(opened.auxWindowId).state, "minimized");
});

test("right-surface requests serialize and a queued request is never dropped", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const updateWindow = chrome.windows.update.bind(chrome.windows);
  let releasePlacement;
  let placementStarted;
  const placementGate = new Promise((resolve) => { releasePlacement = resolve; });
  const placementReady = new Promise((resolve) => { placementStarted = resolve; });
  let held = false;
  chrome.windows.update = async (id, options) => {
    if (!held && id !== opened.phWindowId && id !== opened.auxWindowId &&
      options.state === "normal" && Number.isFinite(options.left)) {
      held = true;
      placementStarted();
      await placementGate;
    }
    return updateWindow(id, options);
  };

  const showMisc = workspace.switchRightSurface("misc", workArea);
  await placementReady;
  const showAux = workspace.switchRightSurface("aux", workArea);
  releasePlacement();
  await Promise.all([showMisc, showAux]);
  const final = await workspace.state();

  assert.equal(final.rightSurface, "aux");
  assert.equal(chrome.getWindow(final.auxWindowId).state, "normal");
  assert.equal(chrome.getWindow(final.miscWindowId).state, "minimized");
});

test("a failed right-surface request does not poison the next request", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const updateWindow = chrome.windows.update.bind(chrome.windows);
  let failPlacement = true;
  chrome.windows.update = async (id, options) => {
    if (failPlacement && id !== opened.phWindowId && id !== opened.auxWindowId &&
      options.state === "normal" && Number.isFinite(options.left)) {
      failPlacement = false;
      throw new Error("simulated incoming placement failure");
    }
    return updateWindow(id, options);
  };

  await assert.rejects(
    workspace.switchRightSurface("misc", workArea),
    /simulated incoming placement failure/,
  );
  assert.equal(chrome.getWindow(opened.auxWindowId).state, "normal");

  const recovered = await workspace.switchRightSurface("misc", workArea);
  assert.equal(recovered.rightSurface, "misc");
  assert.equal(chrome.getWindow(recovered.miscWindowId).state, "normal");
  assert.equal(chrome.getWindow(opened.auxWindowId).state, "minimized");
});

test("requesting the already-visible right surface is physically idempotent", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.calls.updateWindow.length = 0;

  const unchanged = await workspace.switchRightSurface("aux", workArea);

  assert.equal(unchanged.rightSurface, "aux");
  assert.equal(chrome.calls.updateWindow.some(({ id, options }) => (
    id === opened.auxWindowId && (options.state === "minimized" || Number.isFinite(options.left))
  )), false);
  assert.equal(chrome.calls.updateWindow.some(({ id }) => id === opened.phWindowId), false);
});

test("persisted or manually moved Misc geometry cannot override the Aux right rectangle", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const rightRect = (({ height, left, top, width }) => ({ height, left, top, width }))(
    chrome.getWindow(opened.auxWindowId),
  );
  const misc = await workspace.switchRightSurface("misc", workArea);
  chrome.resizeWindow(misc.miscWindowId, { left: 125, top: 90, width: 475 });

  await controller(chrome).rememberVisibleBounds(misc.miscWindowId);
  assert.deepEqual(
    (({ height, left, top, width }) => ({ height, left, top, width }))(chrome.getWindow(misc.miscWindowId)),
    rightRect,
  );
  const state = await workspace.state();
  chrome.setWorkspaceState({
    ...state,
    miscSession: { ...state.miscSession, geometry: { left: 200, width: 500 } },
    rightSlotGeometry: { left: 200, width: 500 },
  });
  const restarted = controller(chrome);

  for (const surface of ["aux", "misc", "aux", "misc"]) {
    const switched = await restarted.switchRightSurface(surface, workArea);
    const windowId = surface === "aux" ? switched.auxWindowId : switched.miscWindowId;
    assert.deepEqual(
      (({ height, left, top, width }) => ({ height, left, top, width }))(chrome.getWindow(windowId)),
      rightRect,
    );
  }
});

test("saved Misc is reused and the hot corner passes it to the verified native rollout", async () => {
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
  const switched = await workspace.switchRightSurface("misc", workArea);
  const miscWindowId = switched.miscWindowId;
  const created = chrome.calls.createWindow.length;
  await workspace.retract();

  const reopened = await workspace.summon(workArea, "display-1", { source: "native hot corner" });

  assert.equal(reopened.rightSurface, "misc");
  assert.equal(reopened.miscWindowId, miscWindowId);
  assert.equal(animations.at(-1).contextWindowId, miscWindowId);
  assert.equal(animations.at(-1).playhouseWindowId, reopened.phWindowId);
  assert.equal(chrome.calls.createWindow.length, created);
});

test("stale Misc runtime IDs adopt the matching restored session without a duplicate", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  await workspace.summon(workArea, "display-1");
  const misc = await workspace.switchRightSurface("misc", workArea);
  chrome.addTab(misc.miscWindowId, "https://example.com/persisted", { active: true, pinned: true });
  await workspace.rememberWorkspaceTabs(misc.miscWindowId, "stale-id-test");
  await workspace.switchRightSurface("aux", workArea);
  const saved = await workspace.state();
  chrome.setWorkspaceState({ ...saved, miscWindowId: 99999 });
  const created = chrome.calls.createWindow.length;

  const restored = await controller(chrome).switchRightSurface("misc", workArea);

  assert.equal(restored.miscWindowId, misc.miscWindowId);
  assert.equal(chrome.calls.createWindow.length, created);
  assert.equal(chrome.getTabs(restored.miscWindowId).at(-1).url, "https://example.com/persisted");
  assert.equal(chrome.getTabs(restored.miscWindowId).at(-1).pinned, true);
});

test("a PlayHouse route swaps Misc for Aux without drawer animation", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const thresholdTransfers = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
    nativeTransferRightSurfaceOwner: async (transfer) => {
      thresholdTransfers.push({ ...transfer, updateCount: chrome.calls.updateWindow.length });
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const playhouseBefore = { ...chrome.getWindow(opened.phWindowId) };
  const misc = await workspace.switchRightSurface("misc", workArea);
  thresholdTransfers.length = 0;
  const animationCount = animations.length;
  chrome.calls.updateWindow.length = 0;

  await workspace.openCarnivalContext("https://mail.google.com/mail/u/0/#all/thread", workArea, "display-1");
  const routed = await workspace.state();

  assert.equal(routed.rightSurface, "aux");
  assert.equal(chrome.getWindow(misc.miscWindowId).state, "minimized");
  assert.equal(chrome.getWindow(routed.auxWindowId).state, "normal");
  assert.equal(chrome.getTab(routed.auxRoleTabIds.gmail).url,
    "https://mail.google.com/mail/u/0/#all/thread");
  assert.deepEqual(chrome.getWindow(opened.phWindowId), playhouseBefore);
  assert.equal(animations.length, animationCount);
  const auxActivateIndex = chrome.calls.updateWindow.findIndex(({ id, options }) => (
    id === routed.auxWindowId && options.focused === true
  ));
  const miscHideIndex = chrome.calls.updateWindow.findIndex(({ id, options }) => (
    id === misc.miscWindowId && options.state === "minimized"
  ));
  assert.ok(auxActivateIndex >= 0 && auxActivateIndex < miscHideIndex);
  assert.equal(thresholdTransfers[0].surface, "aux");
  assert.ok(thresholdTransfers[0].updateCount <= miscHideIndex);
  assert.equal(chrome.calls.updateWindow.some(({ id }) => id === opened.phWindowId), false);
});

test("routing while Aux is already visible performs no right-slot bounds update", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.calls.updateWindow.length = 0;

  await workspace.openCarnivalContext("https://mail.google.com/mail/u/0/#all/thread", workArea, "display-1");

  assert.equal(chrome.calls.updateWindow.some(({ id, options }) => (
    id === opened.auxWindowId && (Object.hasOwn(options, "left") || Object.hasOwn(options, "width"))
  )), false);
  assert.equal(chrome.calls.updateWindow.some(({ id }) => id === opened.phWindowId), false);
});

test("Aux repairs reordered and externally moved Hot Tabs back to canonical order", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const misc = await workspace.switchRightSurface("misc", workArea);
  await workspace.switchRightSurface("aux", workArea);
  const before = await workspace.state();
  chrome.moveTab(before.auxRoleTabIds.gmail, 4);
  await chrome.tabs.move(before.auxRoleTabIds.slack, { index: -1, windowId: misc.miscWindowId });

  await workspace.reconcileAuxTabs(opened.auxWindowId);
  const repaired = await workspace.state();

  assert.deepEqual(chrome.getTabs(opened.auxWindowId).map(({ id }) => id),
    AUX_HOT_TAB_ORDER.map((role) => repaired.auxRoleTabIds[role]));
  assert.equal(chrome.getTab(repaired.auxRoleTabIds.slack).windowId, opened.auxWindowId);
  assert.equal(chrome.getTabs(opened.auxWindowId).length, 5);
});

test("PlayHouse URL order, active tab, and pinned state restore after controller restart", async () => {
  const chrome = fakeChrome();
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const first = await controller(chrome).summon(workArea, "display-1");
  chrome.addTab(first.playhouseWindowId, "https://example.com/a");
  const pageB = chrome.addTab(first.playhouseWindowId, "https://example.com/b", { active: true });
  chrome.addTab(first.playhouseWindowId, "https://example.com/c");
  chrome.moveTab(pageB.id, 2);
  await chrome.tabs.update(first.playhouseTabId, { pinned: true });
  const workspace = controller(chrome);
  await workspace.rememberWorkspaceTabs(first.playhouseWindowId, "tab-session-test");
  const saved = await workspace.state();

  assert.deepEqual(saved.phSession.tabs, {
    activeIndex: 2,
    tabs: [
      { pinned: true, role: "ph-primary", url: PLAYHOUSE_URL },
      { pinned: false, role: null, url: "https://example.com/a" },
      { pinned: false, role: null, url: "https://example.com/b" },
      { pinned: false, role: null, url: "https://example.com/c" },
    ],
  });
  chrome.closeWindow(first.playhouseWindowId);

  const restored = await controller(chrome).summon(workArea, "display-1");

  assert.deepEqual(chrome.getTabs(restored.playhouseWindowId).map(({ active, pinned, url }) => ({ active, pinned, url })), [
    { active: false, pinned: true, url: PLAYHOUSE_URL },
    { active: false, pinned: false, url: "https://example.com/a" },
    { active: true, pinned: false, url: "https://example.com/b" },
    { active: false, pinned: false, url: "https://example.com/c" },
  ]);
  assert.equal(chrome.getTab(restored.playhouseTabId).url, PLAYHOUSE_URL);
});

test("PlayHouse tab mutations replace the persisted logical session without runtime tab IDs", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const opened = await workspace.summon({ height: 900, left: 0, top: 0, width: 1600 }, "display-1");
  const added = chrome.addTab(opened.playhouseWindowId, "https://example.com/original", { active: true });

  await workspace.rememberWorkspaceTabs(opened.playhouseWindowId, "tab-created");
  assert.deepEqual((await workspace.state()).phSession.tabs.tabs.map(({ url }) => url), [
    PLAYHOUSE_URL,
    "https://example.com/original",
  ]);

  chrome.setTab(added.id, { url: "https://example.com/navigated" });
  await workspace.rememberWorkspaceTabs(opened.playhouseWindowId, "tab-url-updated");
  const reordered = chrome.addTab(opened.playhouseWindowId, "https://example.com/reordered");
  chrome.moveTab(reordered.id, 1);
  await workspace.rememberWorkspaceTabs(opened.playhouseWindowId, "tab-moved");
  assert.deepEqual((await workspace.state()).phSession.tabs.tabs.map(({ url }) => url), [
    PLAYHOUSE_URL,
    "https://example.com/reordered",
    "https://example.com/navigated",
  ]);

  chrome.closeTab(reordered.id);
  await workspace.rememberWorkspaceTabs(opened.playhouseWindowId, "tab-removed");
  assert.deepEqual((await workspace.state()).phSession.tabs, {
    activeIndex: 1,
    tabs: [
      { pinned: false, role: "ph-primary", url: PLAYHOUSE_URL },
      { pinned: false, role: null, url: "https://example.com/navigated" },
    ],
  });
});

test("existing Chrome-restored PlayHouse tab is adopted when the saved runtime tab ID is stale", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const existingTabs = chrome.getTabs(opened.playhouseWindowId);
  await workspace.save({
    ...(await workspace.state()),
    phPrimaryTabId: 999999,
  });
  chrome.calls.createTab.length = 0;

  const restored = await workspace.summon(workArea, "display-1");

  assert.equal(restored.playhouseWindowId, opened.playhouseWindowId);
  assert.equal(restored.playhouseTabId, existingTabs[0].id);
  assert.equal(chrome.calls.createTab.length, 0);
  assert.equal(chrome.getTabs(opened.playhouseWindowId).filter(({ url }) => url === PLAYHOUSE_URL).length, 1);
});

test("PH restore adds exactly one real PlayHouse tab and skips restricted saved URLs", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const restored = await workspace.createWindowFromTabs(
    { height: 900, left: 0, top: 0, width: 900 },
    {
      activeIndex: 2,
      tabs: [
        { pinned: false, role: "ph-primary", url: "https://example.com/not-playhouse" },
        { pinned: false, role: null, url: "chrome://settings" },
        { pinned: true, role: null, url: "https://example.com/safe" },
      ],
    },
    "playhouse",
  );

  assert.deepEqual(chrome.getTabs(restored.window.id).map(({ active, pinned, url }) => ({ active, pinned, url })), [
    { active: false, pinned: false, url: PLAYHOUSE_URL },
    { active: false, pinned: false, url: "https://example.com/not-playhouse" },
    { active: true, pinned: true, url: "https://example.com/safe" },
  ]);
  assert.equal(chrome.getTabs(restored.window.id).filter(({ url }) => url === PLAYHOUSE_URL).length, 1);
});

test("PH session diagnostic trail survives close and records the complete hot-corner restore", async () => {
  const chrome = fakeChrome();
  const { phSessionDiagnostics, records, workspace } = phSessionDiagnosticController(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  await phSessionDiagnostics.drain();
  records.length = 0;
  const privateUrl = "https://example.com/private/path?secret=never-log";
  const added = chrome.addTab(initial.playhouseWindowId, privateUrl, { active: true });
  await chrome.tabs.update(initial.playhouseTabId, { pinned: true });
  await workspace.rememberWorkspaceTabs(initial.playhouseWindowId, "tab-created");
  chrome.closeWindow(initial.playhouseWindowId);
  await workspace.handleWindowClosed(initial.playhouseWindowId);
  await phSessionDiagnostics.drain();

  const eventsAfterClose = records.map(({ event }) => event);
  assert.ok(eventsAfterClose.includes("PH_SESSION_SNAPSHOT_CREATED"));
  assert.ok(eventsAfterClose.includes("PH_SESSION_PERSIST_RESULT"));
  assert.ok(eventsAfterClose.includes("PH_WINDOW_REMOVED"));
  assert.equal(records.find(({ event }) => event === "PH_WINDOW_REMOVED")?.details.saved_tab_count, 2);

  const restored = await workspace.summon(workArea, "display-1", { source: "native hot corner" });
  await phSessionDiagnostics.drain();
  const restoreStart = records.findLast(({ event }) => event === "PH_RESTORE_STARTED");
  const verify = records.findLast(({ event }) => event === "PH_RESTORE_VERIFY_RESULT");
  const final = records.findLast(({ event }) => event === "PH_RESTORE_FINAL");

  assert.equal(restoreStart?.details.path, "hot_corner_recreate");
  assert.equal(restoreStart?.details.saved_snapshot_found, true);
  assert.equal(restoreStart?.details.saved_tab_count, 2);
  assert.equal(verify?.details.success, true);
  assert.equal(verify?.details.order_match, true);
  assert.equal(verify?.details.pin_match, true);
  assert.equal(verify?.details.active_match, true);
  assert.equal(final?.details.success, true);
  assert.equal(final?.details.final_tab_count, 2);
  assert.equal(final?.details.correlation_id, restoreStart?.details.correlation_id);
  assert.equal(JSON.stringify(records).includes(privateUrl), false);
  assert.equal(JSON.stringify(records).includes("private/path"), false);
  assert.equal(chrome.getTabs(restored.playhouseWindowId).find((tab) => tab.id === added.id), undefined);
});

test("PH session diagnostic failure cannot interrupt tab persistence", async () => {
  const chrome = fakeChrome();
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    phSessionDiagnostics: { record() { throw new Error("diagnostic failure"); } },
  });
  const opened = await workspace.summon({ height: 900, left: 0, top: 0, width: 1600 }, "display-1");
  chrome.addTab(opened.playhouseWindowId, "https://example.com/safe", { active: true });

  await assert.doesNotReject(workspace.rememberWorkspaceTabs(opened.playhouseWindowId, "tab-created"));
  assert.equal((await workspace.state()).phSession.tabs.tabs.length, 2);
});

test("three-tab PH restore suppresses reconstruction saves and performs one verified final save", async () => {
  const chrome = fakeChrome();
  const { events, workspace } = diagnosticController(chrome);
  const tabs = {
    activeIndex: 2,
    tabs: [
      { pinned: false, role: "ph-primary", url: PLAYHOUSE_URL },
      { pinned: false, role: null, url: "https://example.com/a" },
      { pinned: false, role: null, url: "https://example.com/b" },
    ],
  };
  const geometry = { left: 200, width: 700 };
  const restored = await workspace.createWindowFromTabs(
    { ...geometry, height: 900, top: 0 }, tabs, "playhouse", "PH-3-TABS",
  );
  await workspace.save({
    auxSession: { geometry: null, tabs: defaultAuxTabs() },
    auxWindowId: null,
    drawerState: "open",
    layoutVersion: 2,
    phPrimaryTabId: restored.roleTabIds["ph-primary"],
    phSession: { geometry, tabs },
    phWindowId: restored.window.id,
    workArea: { height: 900, left: 0, top: 0, width: 1800 },
  });

  for (const reason of ["tab-activated", "tab-url-updated", "tab-load-complete"]) {
    assert.equal(await workspace.rememberWorkspaceTabs(restored.window.id, reason), null);
  }
  assert.equal((await workspace.state()).phSession.tabs.tabs.length, 3);
  assert.equal(events.some(({ event }) => event === "PH_SESSION_SAVE_COMPLETE"), false);
  assert.equal(events.filter(({ event }) => event === "PH_SESSION_SAVE_SKIPPED").length, 3);

  await workspace.finalizeRestoredWindow("playhouse", restored, "PH-3-TABS");
  const final = await workspace.state();
  assert.deepEqual(final.phSession.tabs.tabs.map(({ role }) => role), ["ph-primary", null, null]);
  assert.equal(final.phSession.tabs.tabs.length, 3);
  assert.equal(events.filter(({ event }) => event === "PH_RESTORE_VERIFIED").length, 1);
  assert.equal(events.filter(({ event }) => event === "PH_RESTORE_FINAL_SAVE").length, 1);
});

test("Aux restore suppresses reconstruction events until its role set is verified", async () => {
  const chrome = fakeChrome();
  const { events, workspace } = diagnosticController(chrome);
  const tabs = {
    activeIndex: 4,
    tabs: defaultAuxTabs().tabs,
  };
  const geometry = { left: 1000, width: 600 };
  const restored = await workspace.createWindowFromTabs(
    { ...geometry, height: 900, top: 0 }, tabs, "context", "AUX-4-TABS",
  );
  await workspace.save({
    auxActiveTabId: restored.activeTab.id,
    auxRoleTabIds: restored.roleTabIds,
    auxSession: { geometry, tabs },
    auxWindowId: restored.window.id,
    drawerState: "open",
    layoutVersion: 2,
    phSession: { geometry: null, tabs: defaultPlayhouseTabs(PLAYHOUSE_URL) },
    phWindowId: null,
    workArea: { height: 900, left: 0, top: 0, width: 1800 },
  });

  assert.equal(await workspace.rememberWorkspaceTabs(restored.window.id, "tab-pin-updated"), null);
  assert.equal(events.some(({ event }) => event === "AUX_SESSION_SAVE_COMPLETE"), false);
  await workspace.finalizeRestoredWindow("context", restored, "AUX-4-TABS");

  assert.equal((await workspace.state()).auxSession.tabs.tabs.length, 5);
  assert.equal(events.filter(({ event }) => event === "AUX_RESTORE_VERIFIED").length, 1);
  assert.equal(events.filter(({ event }) => event === "AUX_RESTORE_FINAL_SAVE").length, 1);
});

test("restore and animation bounds never replace geometry until a later user move", async () => {
  const chrome = fakeChrome();
  const { events, workspace } = diagnosticController(chrome, { geometrySettleMs: 0 });
  const phGeometry = { left: 200, width: 700 };
  const auxGeometry = { left: 1000, width: 600 };
  const ph = await workspace.createWindowFromTabs(
    { ...phGeometry, height: 900, top: 0 }, defaultPlayhouseTabs(PLAYHOUSE_URL), "playhouse",
  );
  const aux = await workspace.createWindowFromTabs(
    { ...auxGeometry, height: 900, top: 0 }, defaultAuxTabs(), "context",
  );
  await workspace.save({
    auxActiveTabId: aux.activeTab.id,
    auxRoleTabIds: aux.roleTabIds,
    auxSession: { geometry: auxGeometry, tabs: aux.tabState },
    auxWindowId: aux.window.id,
    drawerState: "open",
    layoutVersion: 2,
    phPrimaryTabId: ph.roleTabIds["ph-primary"],
    phSession: { geometry: phGeometry, tabs: ph.tabState },
    phWindowId: ph.window.id,
    workArea: { height: 900, left: 0, top: 0, width: 1800 },
  });

  chrome.resizeWindow(ph.window.id, { left: 834 });
  chrome.resizeWindow(aux.window.id, { left: 846 });
  assert.equal(await workspace.rememberVisibleBounds(ph.window.id), null);
  assert.equal(await workspace.rememberVisibleBounds(aux.window.id), null);
  assert.deepEqual((await workspace.state()).phSession.geometry, { left: 0, width: phGeometry.width });
  assert.deepEqual((await workspace.state()).auxSession.geometry, auxGeometry);

  chrome.resizeWindow(ph.window.id, { left: phGeometry.left });
  chrome.resizeWindow(aux.window.id, { left: auxGeometry.left });
  await workspace.finalizeRestoredWindow("playhouse", ph);
  await workspace.finalizeRestoredWindow("context", aux);
  chrome.resizeWindow(ph.window.id, { left: 820 });
  assert.equal(await workspace.rememberVisibleBounds(ph.window.id), null);
  assert.deepEqual((await workspace.state()).phSession.geometry, { left: 0, width: phGeometry.width });
  await new Promise((resolve) => setTimeout(resolve, 0));
  chrome.resizeWindow(ph.window.id, { left: 250 });
  await workspace.rememberVisibleBounds(ph.window.id);

  assert.deepEqual((await workspace.state()).phSession.geometry, { left: 0, width: 700 });
  assert.equal(events.filter(({ event, details }) => (
    event === "GEOMETRY_SAVE_SKIPPED" && details.reason === "system-change"
  )).length, 3);
});

test("a deliberately closed Gmail Hot Tab is self-healed", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  chrome.closeTab(initial.contextRoleTabIds.gmail);
  await workspace.reconcileAuxTabs(initial.contextWindowId);
  const state = await workspace.state();
  assert.equal(chrome.getTabs(initial.contextWindowId).length, 5);
  assert.equal(
    chrome.getTab(state.contextRoleTabIds.gmail).url,
    AUX_ROLE_URLS.gmail,
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

test("Drive routing reuses the Play/Chrome Hot Tab without touching unrelated windows", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  const unrelatedWindow = await chrome.windows.create({
    focused: false,
    height: 700,
    left: 1700,
    state: "normal",
    top: 0,
    url: "https://drive.google.com/drive/folders/UNRELATED",
    width: 900,
  });
  const unrelatedDrive = chrome.getTabs(unrelatedWindow.id)[0];
  chrome.calls.createWindow.length = 0;
  chrome.calls.createTab.length = 0;
  chrome.calls.updateWindow.length = 0;

  await workspace.openCarnivalContext(
    "https://drive.google.com/drive/folders/ABC123",
    workArea,
    "display-1",
  );
  const afterFirst = await workspace.state();
  await workspace.openCarnivalContext(
    "https://drive.google.com/drive/folders/XYZ789",
    workArea,
    "display-1",
  );
  const afterSecond = await workspace.state();

  assert.equal(chrome.calls.createWindow.length, 0);
  assert.equal(chrome.calls.createTab.length, 0);
  assert.equal(afterFirst.auxRoleTabIds.misc, afterSecond.auxRoleTabIds.misc);
  assert.equal(chrome.getTab(afterSecond.auxRoleTabIds.misc).url,
    "https://drive.google.com/drive/folders/XYZ789");
  assert.equal(chrome.getTab(unrelatedDrive.id).url,
    "https://drive.google.com/drive/folders/UNRELATED");
  assert.equal(chrome.getWindow(initial.playhouseWindowId).left, workArea.left);
});

test("PlayHouse geometry is anchored on primary and left-side monitor work areas while width varies", () => {
  assert.deepEqual(getAnchoredPlayhouseGeometry(
    { height: 1200, left: 0, top: 0, width: 1920 }, 861,
  ), { height: 1200, left: 0, top: 0, width: 861 });
  assert.deepEqual(getAnchoredPlayhouseGeometry(
    { height: 1080, left: -1920, top: 40, width: 1920 }, 1000,
  ), { height: 1080, left: -1920, top: 40, width: 1000 });
});

test("native animation landing comparison accepts frame tolerance and rejects translated endpoints", () => {
  const target = { height: 1200, left: 299, top: 0, width: 861 };
  assert.deepEqual(compareAnimationLanding({ ...target, left: 300 }, target), {
    landed: true,
    leftDelta: 1,
  });
  assert.deepEqual(compareAnimationLanding({ ...target, left: 500 }, target), {
    landed: false,
    leftDelta: 201,
  });
});

test("cold native startup adopts the resolving Chrome window and creates only Aux", async () => {
  const chrome = fakeChrome();
  const startupWindow = await chrome.windows.create({
    focused: true,
    height: 900,
    left: 40,
    state: "normal",
    top: 20,
    type: "normal",
    url: "about:blank",
    width: 900,
  });
  chrome.setTab(startupWindow.tabs[0].id, { status: "loading" });
  const unrelatedTab = chrome.addTab(startupWindow.id, "https://example.com/", { active: false });
  const unrelatedWindow = await chrome.windows.create({
    focused: false,
    height: 700,
    left: 1200,
    state: "normal",
    top: 50,
    type: "normal",
    url: "https://example.org/",
    width: 500,
  });
  chrome.calls.createWindow.length = 0;
  chrome.calls.updateWindow.length = 0;
  const traceEvents = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { info() {}, warn() {} },
    windowTrace: {
      afterCreate() {},
      async beforeCreate() { return "test-create"; },
      async beforeUpdate() {},
      createFailed() {},
      async discovery() {},
      emit(eventSource, event, details) { traceEvents.push({ details, event, eventSource }); },
      enter() {},
      exit() {},
    },
  });
  const workArea = { height: 900, left: 100, top: 0, width: 1600 };
  const summon = workspace.summon(workArea, null, {
    allowColdStartPlayhouseAdoption: true,
    coldStartCandidateWindowIds: [startupWindow.id],
  });
  for (let attempt = 0; attempt < 20 && chrome.tabUpdatedListenerCount === 0; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(chrome.tabUpdatedListenerCount, 1);
  await chrome.tabs.update(startupWindow.tabs[0].id, {
    status: "complete",
    url: PLAYHOUSE_URL,
  });

  const state = await summon;
  assert.equal(state.phWindowId, startupWindow.id);
  assert.equal(state.phPrimaryTabId, startupWindow.tabs[0].id);
  assert.equal(chrome.calls.createWindow.length, 1);
  assert.equal(chrome.calls.createWindow[0].url[0], DEFAULT_CONTEXT_URL);
  assert.equal(chrome.getTabs(startupWindow.id).some(({ id }) => id === unrelatedTab.id), true);
  assert.equal(chrome.calls.updateWindow.some(({ id }) => id === unrelatedWindow.id), false);
  assert.ok(traceEvents.some(({ event }) => event === "PLAYHOUSE_ADOPTED"));
  assert.equal(chrome.getWindow(startupWindow.id).left, workArea.left);
  assert.equal(state.phSession.geometry.left, workArea.left);

  const retracted = await workspace.retract();
  assert.equal(retracted.phSession.geometry.left, workArea.left);
  assert.equal(chrome.calls.createWindow.length, 1);

  const warmChrome = fakeChrome();
  const warmWorkspace = controller(warmChrome);
  const warm = await warmWorkspace.summon(workArea, "display-1");

  assert.equal(warm.phSession.geometry.left, state.phSession.geometry.left);
});

test("warm startup never waits for or adopts an unrelated loading window", async () => {
  const chrome = fakeChrome();
  const ordinary = await chrome.windows.create({
    focused: true,
    height: 900,
    left: 0,
    state: "normal",
    top: 0,
    type: "normal",
    url: "about:blank",
    width: 900,
  });
  chrome.setTab(ordinary.tabs[0].id, { status: "loading" });
  chrome.calls.createWindow.length = 0;

  const state = await controller(chrome).summon(
    { height: 900, left: 0, top: 0, width: 1600 },
    null,
    { allowColdStartPlayhouseAdoption: false, coldStartCandidateWindowIds: [ordinary.id] },
  );

  assert.notEqual(state.phWindowId, ordinary.id);
  assert.equal(chrome.calls.createWindow.length, 2);
  assert.equal(chrome.tabUpdatedListenerCount, 0);
});

test("startup reuses the existing PlayHouse across query changes and stale saved tab IDs", async () => {
  const chrome = fakeChrome();
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const firstController = controller(chrome);
  const opened = await firstController.summon(workArea, "display-1");
  await chrome.tabs.update(opened.phPrimaryTabId, {
    url: `${PLAYHOUSE_URL}?view=tomorrow`,
  });
  await firstController.save({
    ...opened,
    auxActiveTabId: 9998,
    contextTabId: 9998,
    phPrimaryTabId: 9999,
    playhouseTabId: 9999,
  });
  const createdBeforeRestart = chrome.calls.createWindow.length;

  const restored = await controller(chrome).summon(workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, createdBeforeRestart);
  assert.equal(restored.phWindowId, opened.phWindowId);
  assert.equal(restored.auxWindowId, opened.auxWindowId);
  assert.equal(chrome.getTabs(opened.phWindowId).some(({ url }) => (
    url === `${PLAYHOUSE_URL}?view=tomorrow`
  )), true);
});

test("concurrent startup requests create exactly one PlayHouse and one Aux window", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const actions = createWorkspaceActions({
    controller: workspace,
    logger: { info() {} },
    reportDrawerState() {},
    validWorkArea: () => true,
  });
  const display = { monitorId: "display-1", workArea };

  const [toolbar, native] = await Promise.all([
    actions.summon(display, "toolbar"),
    actions.summon(display, "native hot corner"),
  ]);

  assert.equal(chrome.calls.createWindow.length, 2);
  assert.equal(toolbar.phWindowId, native.phWindowId);
  assert.equal(toolbar.auxWindowId, native.auxWindowId);
});

test("restored Aux routing leaves unrelated Chrome windows untouched", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  await workspace.summon(workArea, "display-1");
  const unrelated = await chrome.windows.create({
    focused: false,
    height: 700,
    left: 200,
    state: "normal",
    top: 80,
    type: "normal",
    url: "https://example.net/unrelated",
    width: 900,
  });
  const before = { ...chrome.getWindow(unrelated.id) };
  chrome.calls.createWindow.length = 0;
  chrome.calls.updateWindow.length = 0;

  await workspace.openCarnivalContext("https://example.com/reference", workArea, "display-1");
  await workspace.openCarnivalContext("https://mail.google.com/mail/u/0/#all/thread-1", workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 0);
  assert.equal(chrome.calls.updateWindow.some(({ id }) => id === unrelated.id), false);
  assert.deepEqual(chrome.getWindow(unrelated.id), before);
});

test("an arbitrary tab cannot replace a missing Play/Chrome Hot Tab", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  chrome.closeTab(initial.contextRoleTabIds.misc);
  const arbitrary = chrome.addTab(initial.contextWindowId, "https://example.com/arbitrary", {
    active: true,
  });

  await workspace.reconcileAuxTabs(initial.contextWindowId, { revealMisc: true });
  const state = await workspace.state();

  assert.equal(chrome.getTab(state.contextRoleTabIds.misc).url, AUX_ROLE_URLS.misc);
  assert.equal(chrome.getTab(arbitrary.id).windowId, state.miscWindowId);
  assert.equal(state.rightSurface, "misc");
  assert.equal(chrome.getTabs(initial.contextWindowId).length, 5);
});

test("PlayHouse routes Calendar, Gmail, Contacts, Slack, and URLs by revealing only existing Aux", async () => {
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
  await workspace.retract();
  const before = await workspace.state();
  const playhouseBefore = { ...chrome.getWindow(opened.playhouseWindowId) };
  const unrelated = await chrome.windows.create({
    focused: true,
    height: 700,
    left: 200,
    state: "normal",
    top: 80,
    type: "normal",
    url: "https://example.net/unrelated",
    width: 900,
  });
  const unrelatedBefore = { ...chrome.getWindow(unrelated.id) };
  chrome.resizeWindow(opened.contextWindowId, { left: -2000, state: "minimized" });
  chrome.calls.createWindow.length = 0;
  chrome.calls.updateWindow.length = 0;

  for (const url of [
    "https://calendar.google.com/calendar/u/0/r/week",
    "https://mail.google.com/mail/u/0/#all/thread-1",
    "https://contacts.google.com/person/c123",
    "https://app.slack.com/client/T1/C1",
    "https://example.com/play",
  ]) {
    await workspace.openCarnivalContext(url, workArea, "display-1");
  }

  const after = await workspace.state();
  assert.equal(chrome.calls.createWindow.length, 0);
  assert.equal(animations.length, 2);
  assert.equal(chrome.calls.updateWindow.some(({ id }) => id === opened.playhouseWindowId), false);
  assert.equal(chrome.calls.updateWindow.some(({ id }) => id === unrelated.id), false);
  assert.deepEqual(chrome.getWindow(opened.playhouseWindowId), playhouseBefore);
  assert.deepEqual(chrome.getWindow(unrelated.id), unrelatedBefore);
  assert.deepEqual(after.phSession.geometry, before.phSession.geometry);
  assert.deepEqual(after.auxSession.geometry, before.auxSession.geometry);
  assert.equal(after.drawerState, before.drawerState);
  assert.equal(chrome.getTab(after.auxRoleTabIds.calendar).url,
    "https://calendar.google.com/calendar/u/0/r/week");
  assert.equal(chrome.getTab(after.auxRoleTabIds.gmail).url,
    "https://mail.google.com/mail/u/0/#all/thread-1");
  assert.equal(chrome.getTab(after.auxRoleTabIds.contacts).url,
    "https://contacts.google.com/person/c123");
  assert.equal(chrome.getTab(after.auxRoleTabIds.slack).url,
    "https://app.slack.com/client/T1/C1");
  assert.equal(chrome.getTab(after.auxRoleTabIds.misc).url, "https://example.com/play");
});

test("PlayHouse routing recreates a missing Aux without moving PlayHouse", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const initial = await workspace.summon(workArea, "display-1");
  chrome.closeWindow(initial.contextWindowId);
  chrome.calls.createWindow.length = 0;
  chrome.calls.updateWindow.length = 0;

  const playhouseBefore = { ...chrome.getWindow(initial.playhouseWindowId) };
  await workspace.openCarnivalContext("https://example.com/recreated", workArea, "display-1");
  const state = await workspace.state();

  assert.equal(chrome.calls.createWindow.length, 1);
  assert.equal(chrome.getTab(state.auxRoleTabIds.misc).url, "https://example.com/recreated");
  assert.deepEqual(chrome.getWindow(initial.playhouseWindowId), playhouseBefore);
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

test("a PlayHouse-only bounds event normalizes X when Aux is temporarily offscreen", async () => {
  const chrome = fakeChrome();
  const { workspace } = diagnosticController(chrome, { geometrySettleMs: 0 });
  const workArea = { height: 900, left: 100, top: 20, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const priorAux = opened.auxSession.geometry;
  await new Promise((resolve) => setTimeout(resolve, 0));
  chrome.resizeWindow(opened.playhouseWindowId, { left: 145 });
  chrome.resizeWindow(opened.contextWindowId, { left: -1800 });

  const saved = await workspace.rememberVisibleBounds(opened.playhouseWindowId);

  assert.deepEqual(saved.phSession.geometry, {
    left: 100,
    width: opened.phSession.geometry.width,
  });
  assert.deepEqual(saved.auxSession.geometry, priorAux);
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

test("settled geometry anchors PlayHouse and restores full monitor height", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 20, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(opened.playhouseWindowId, { height: 600, left: 40, top: 100, width: 700 });
  chrome.resizeWindow(opened.contextWindowId, { height: 700, left: 850, top: 80, width: 500 });

  const saved = await workspace.rememberVisibleBounds();

  assert.deepEqual(saved.phSession.geometry, { left: 0, width: 700 });
  assert.deepEqual(saved.auxSession.geometry, { left: 850, width: 500 });
  assert.deepEqual(chrome.calls.updateWindow.slice(-2).map(({ id, options }) => ({ id, options })), [
    {
      id: opened.playhouseWindowId,
      options: { focused: false, height: 900, left: 0, state: "normal", top: 20, width: 700 },
    },
    {
      id: opened.contextWindowId,
      options: { focused: false, height: 900, state: "normal", top: 20 },
    },
  ]);
});

test("PlayHouse anchor and independent Aux geometry persist through retract and reopen", async () => {
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
    height: 900, left: 0, top: 0, width: 700,
  });
  assert.deepEqual(animations.at(-1).context.to, {
    height: 900, left: 850, top: 0, width: 600,
  });
  assert.equal(animations.at(-1).context.to.left, 850);
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
    "https://calendar.google.com/calendar/u/0/r/week",
    "https://mail.google.com/mail/u/0/#inbox",
    "https://contacts.google.com/",
    "https://app.slack.com/",
    "https://www.google.com/",
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

test("PH and Misc sessions restore independently while Aux remains canonical", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1800 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.addTab(opened.playhouseWindowId, "https://example.com/a");
  chrome.addTab(opened.playhouseWindowId, "https://example.com/b", { active: true });
  chrome.addTab(opened.contextWindowId, "https://youtube.com/", { active: true });
  await workspace.rememberWorkspaceTabs(opened.playhouseWindowId);
  await workspace.reconcileAuxTabs(opened.contextWindowId, { revealMisc: true });
  await workspace.switchRightSurface("aux", workArea);
  const canonicalAux = await workspace.state();
  chrome.resizeWindow(canonicalAux.auxWindowId, { left: 900, width: 650 });
  await controller(chrome).rememberVisibleBounds(canonicalAux.auxWindowId);
  await workspace.switchRightSurface("misc", workArea);
  const withMisc = await workspace.state();
  await workspace.rememberWorkspaceTabs(withMisc.miscWindowId);
  chrome.resizeWindow(opened.playhouseWindowId, { left: 120, width: 700 });
  chrome.resizeWindow(withMisc.miscWindowId, { left: 800, width: 500 });
  await controller(chrome).rememberVisibleBounds();
  chrome.closeWindow(opened.playhouseWindowId);
  chrome.closeWindow(opened.contextWindowId);
  chrome.closeWindow(withMisc.miscWindowId);
  await Promise.all([
    workspace.handleWindowClosed(opened.playhouseWindowId),
    workspace.handleWindowClosed(opened.contextWindowId),
    workspace.handleWindowClosed(withMisc.miscWindowId),
  ]);

  const restored = await controller(chrome).summon(workArea, "display-1");
  const phTabs = chrome.getTabs(restored.phWindowId);
  const miscTabs = chrome.getTabs(restored.miscWindowId);

  assert.deepEqual(phTabs.map(({ url }) => url), [PLAYHOUSE_URL, "https://example.com/a", "https://example.com/b"]);
  assert.equal(phTabs[2].active, true);
  const restoredController = controller(chrome);
  await restoredController.switchRightSurface("aux", workArea);
  const withAux = await restoredController.state();
  const auxTabs = chrome.getTabs(withAux.auxWindowId);
  assert.deepEqual(auxTabs.map(({ url }) => url), [
    DEFAULT_CONTEXT_URL,
    "https://mail.google.com/mail/u/0/#inbox",
    "https://contacts.google.com/",
    "https://app.slack.com/",
    "https://www.google.com/",
  ]);
  assert.deepEqual(miscTabs.map(({ url }) => url), ["https://www.google.com/", "https://youtube.com/"]);
  assert.equal(miscTabs[1].active, true);
  assert.deepEqual(
    { left: chrome.getWindow(restored.phWindowId).left, width: chrome.getWindow(restored.phWindowId).width },
    { left: 0, width: 700 },
  );
  assert.deepEqual(
    { left: chrome.getWindow(withAux.auxWindowId).left, width: chrome.getWindow(withAux.auxWindowId).width },
    { left: 900, width: 650 },
  );
  assert.equal(chrome.getTab(restored.phPrimaryTabId).url, PLAYHOUSE_URL);
  assert.equal(chrome.getTab(withAux.auxRoleTabIds.gmail).url, "https://mail.google.com/mail/u/0/#inbox");
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

test("retract captures Aux geometry and PlayHouse width while anchoring PlayHouse", async () => {
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

  assert.deepEqual(retracted.phSession.geometry, { left: 0, width: 760 });
  assert.deepEqual(retracted.auxSession.geometry, { left: 910, width: 620 });
});

test("manual PlayHouse movement is discarded across repeated retract and summon cycles", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      chrome.resizeWindow(animation.playhouseWindowId, animation.playhouse.to);
      chrome.resizeWindow(animation.contextWindowId, animation.context.to);
      return true;
    },
  });
  const workArea = { height: 900, left: 100, top: 20, width: 1700 };
  const opened = await workspace.summon(workArea, "display-1");
  chrome.resizeWindow(opened.playhouseWindowId, { left: 175 });
  await workspace.rememberVisibleBounds(opened.playhouseWindowId);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    const retracted = await workspace.retract();
    assert.equal(retracted.phSession.geometry.left, workArea.left);
    const reopened = await workspace.summon(workArea, "display-1");
    assert.equal(reopened.phSession.geometry.left, workArea.left);
    assert.equal(animations.at(-2).playhouse.from.left, workArea.left);
    assert.equal(animations.at(-2).playhouse.to.left, workArea.left - workArea.width);
    assert.equal(animations.at(-1).playhouse.from.left, workArea.left - workArea.width);
    assert.equal(animations.at(-1).playhouse.to.left, workArea.left);
  }
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

test("first retract and repeated native cycles move both windows and reuse the pair", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    logger: { warn() {} },
    nativeAnimate: async (animation) => {
      animations.push(animation);
      chrome.resizeWindow(animation.playhouseWindowId, animation.playhouse.to);
      chrome.resizeWindow(animation.contextWindowId, animation.context.to);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const createdCount = chrome.calls.createWindow.length;

  const retracted = await workspace.retract();
  assert.equal(retracted.drawerState, "retracted");
  assert.equal(chrome.getWindow(opened.playhouseWindowId).left, -1600);
  assert.equal(chrome.getWindow(opened.contextWindowId).left, -700);

  let reopened;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    reopened = await workspace.summon(workArea, "display-1");
    assert.equal(chrome.getWindow(opened.playhouseWindowId).left, 0);
    assert.equal(chrome.getWindow(opened.contextWindowId).left, 900);
    if (cycle < 2) {
      const cycleRetracted = await workspace.retract();
      assert.equal(cycleRetracted.drawerState, "retracted");
      assert.equal(chrome.getWindow(opened.playhouseWindowId).left, -1600);
      assert.equal(chrome.getWindow(opened.contextWindowId).left, -700);
    }
  }

  assert.equal(reopened.drawerState, "open");
  assert.equal(reopened.playhouseWindowId, opened.playhouseWindowId);
  assert.equal(reopened.contextWindowId, opened.contextWindowId);
  assert.equal(chrome.calls.createWindow.length, createdCount);

  assert.equal(animations.length, 7);
  assert.equal(animations[0].action, "open");
  for (const animation of animations.slice(1)) {
    const retracting = animation.action === "retract";
    assert.equal(animation.playhouse.from.left, retracting ? 0 : -1600);
    assert.equal(animation.playhouse.to.left, retracting ? -1600 : 0);
    assert.equal(animation.context.from.left, retracting ? 900 : -700);
    assert.equal(animation.context.to.left, retracting ? -700 : 900);
  }
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

test("Windows native animation receives direction-aware geometry for both windows", async () => {
  const chrome = fakeChrome();
  const animations = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    nativeAnimate: async (animation) => {
      animations.push(animation);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };

  const opened = await workspace.summon(workArea, "display-1");
  await workspace.retract();

  assert.equal(animations.length, 2);
  assert.equal(animations[0].durationMs, 450);
  assert.equal(animations[0].playhouseWindowId, opened.playhouseWindowId);
  assert.equal(animations[0].contextWindowId, opened.contextWindowId);
  assert.equal(animations[0].action, "open");
  assert.equal(animations[0].easing, "out");
  assert.deepEqual(animations[0].playhouse.current, { height: 900, left: 0, top: 0, width: 900 });
  assert.deepEqual(animations[0].playhouse.from, { height: 900, left: -1600, top: 0, width: 900 });
  assert.deepEqual(animations[0].playhouse.to, { height: 900, left: 0, top: 0, width: 900 });
  assert.equal(animations[0].context.from.left, -700);
  assert.equal(animations[1].action, "retract");
  assert.equal(animations[1].easing, "in");
  assert.equal(animations[1].durationMs, 400);
  assert.deepEqual(animations[1].playhouse.from, animations[0].playhouse.to);
  assert.deepEqual(animations[1].playhouse.to, animations[0].playhouse.from);
  assert.deepEqual(animations[0].workArea, workArea);
  assert.equal(chrome.calls.updateWindow.filter(({ options }) => (
    Object.keys(options).length === 1 && Number.isInteger(options.left)
  )).length, 0);
});

test("retracted native summon hands off offscreen animation bounds without Chrome window updates", async () => {
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
  assert.equal(animations.at(-1).playhouse.from.left, workArea.left - workArea.width);
  assert.ok(animations.at(-1).context.from.left < workArea.left);
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
  assert.equal(animations[0].playhouse.from.left, workArea.left - workArea.width);
  assert.deepEqual(animations[0].playhouse.current, animations[0].playhouse.to);
  assert.deepEqual(animations[0].context.current, animations[0].context.to);
});

test("canonical retracted geometry shifts the complete visible pair without changing dimensions", () => {
  const workArea = { height: 900, left: 100, top: 20, width: 1600 };
  const visible = {
    playhouse: { height: 900, left: 100, top: 20, width: 900 },
    context: { height: 900, left: 1000, top: 20, width: 600 },
  };

  assert.deepEqual(canonicalRetractedWorkspaceLayout(visible, workArea), {
    playhouse: { height: 900, left: -1500, top: 20, width: 900 },
    context: { height: 900, left: -600, top: 20, width: 600 },
  });
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

test("native retraction failure restores the visible workspace and leaves it logically open", async () => {
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
  assert.deepEqual(
    chrome.calls.updateWindow.filter(({ options }) => Number.isInteger(options.left)).map(({ options }) => options.left),
    [0, 900],
  );
});
