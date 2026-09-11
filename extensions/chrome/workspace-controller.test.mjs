import assert from "node:assert/strict";
import test from "node:test";

import {
  CarnivalWorkspaceController,
  DEFAULT_CONTEXT_URL,
  defaultWorkspaceLayout,
  effectiveRetractThreshold,
  isAllowedContextUrl,
  restoredWorkspaceLayout,
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
    resizeWindow(id, bounds) { windows.set(id, { ...windows.get(id), ...bounds }); },
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
      async query({ url } = {}) {
        if (!url) return [...tabs.values()];
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

test("repeated summons reuse both identified Chrome windows", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };

  const first = await workspace.summon(workArea, "display-1");
  const second = await workspace.summon(workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 2);
  assert.equal(second.playhouseWindowId, first.playhouseWindowId);
  assert.equal(second.contextWindowId, first.contextWindowId);
  assert.equal(chrome.calls.createWindow[1].url, DEFAULT_CONTEXT_URL);
});

test("opening context reuses the context tab and validates its URL", async () => {
  const chrome = fakeChrome();
  const workspace = controller(chrome);
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };

  await workspace.openCarnivalContext("https://example.com/play", workArea, "display-1");

  assert.equal(chrome.calls.createWindow.length, 2);
  assert.deepEqual(chrome.calls.updateTab.at(-1)?.options, {
    active: true,
    url: "https://example.com/play",
  });
  await assert.rejects(
    workspace.openCarnivalContext("chrome://settings", workArea, "display-1"),
    /HTTP or HTTPS/,
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

  assert.deepEqual(saved.savedVisibleBounds, {
    context: { height: 900, left: 850, top: 20, width: 500 },
    playhouse: { height: 900, left: 40, top: 20, width: 700 },
  });
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
  assert.equal(
    chrome.calls.createWindow.at(-1).url,
    "https://calendar.google.com/calendar/u/0/r/week",
  );
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
