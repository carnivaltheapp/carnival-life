import assert from "node:assert/strict";
import test from "node:test";

import {
  CarnivalWorkspaceController,
  coupledWorkspaceLayout,
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

test("saved widths are restored left-anchored at full monitor height", () => {
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  assert.deepEqual(restoredWorkspaceLayout({
    contextBounds: { height: 800, left: 900, top: 30, width: 500 },
    layoutVersion: 2,
    monitorId: "display-1",
    playhouseBounds: { height: 800, left: 0, top: 30, width: 900 },
    workArea,
  }, workArea, "chrome-display-1"), {
    context: { height: 900, left: 900, top: 0, width: 500 },
    playhouse: { height: 900, left: 0, top: 0, width: 900 },
  });
});

test("missing-monitor geometry is normalized onto the current work area with its split ratio", () => {
  const priorWorkArea = { height: 900, left: 0, top: 0, width: 1600 };
  const workArea = { height: 1000, left: 100, top: 20, width: 2000 };
  const restored = restoredWorkspaceLayout({
    contextBounds: { height: 800, left: 720, top: 30, width: 880 },
    layoutVersion: 2,
    monitorId: "missing-display",
    playhouseBounds: { height: 800, left: 0, top: 30, width: 720 },
    workArea: priorWorkArea,
  }, workArea, "current-display");

  assert.equal(restored.playhouse.left, workArea.left);
  assert.equal(restored.playhouse.top, workArea.top);
  assert.equal(restored.playhouse.width, 720);
  assert.equal(restored.context.width, 880);
  assert.equal(restored.context.left, restored.playhouse.left + restored.playhouse.width);
  assert.equal(restored.context.top, workArea.top);
  assert.equal(restored.context.height, workArea.height);
  assert.equal(restored.context.left + restored.context.width <= workArea.left + workArea.width, true);
  assert.ok(Math.abs(restored.playhouse.width /
    (restored.playhouse.width + restored.context.width) - 0.45) < 0.01);
});

test("coupled resize preserves a 900/600 ratio when shrinking and growing", () => {
  const workArea = { height: 900, left: 0, top: 0, width: 2000 };
  assert.deepEqual(coupledWorkspaceLayout(workArea, 900, 600, 1400), {
    context: { height: 900, left: 840, top: 0, width: 560 },
    playhouse: { height: 900, left: 0, top: 0, width: 840 },
  });
  assert.deepEqual(coupledWorkspaceLayout(workArea, 900, 600, 1600), {
    context: { height: 900, left: 960, top: 0, width: 640 },
    playhouse: { height: 900, left: 0, top: 0, width: 960 },
  });
});

test("live coupled resize keeps one frozen ratio across every intermediate frame", () => {
  const workArea = { height: 900, left: 0, top: 0, width: 2000 };
  const frames = [1450, 1400, 1350].map((right) => (
    coupledWorkspaceLayout(workArea, 900, 600, right)
  ));

  assert.deepEqual(frames.map(({ context, playhouse }) => [playhouse.width, context.width]), [
    [870, 580],
    [840, 560],
    [810, 540],
  ]);
  for (const frame of frames) {
    assert.equal(frame.playhouse.left + frame.playhouse.width, frame.context.left);
    assert.equal(frame.context.left + frame.context.width,
      frame.playhouse.width + frame.context.width);
    assert.equal(frame.playhouse.width / (frame.playhouse.width + frame.context.width), 0.6);
  }
});

test("live coupled resize caps the workspace at monitor width minus the 100px retract zone", () => {
  const layout = coupledWorkspaceLayout(
    { height: 900, left: 100, top: 20, width: 1600 },
    900,
    600,
    5000,
  );

  assert.equal(layout.context.left + layout.context.width, 1600);
  assert.equal(layout.playhouse.width + layout.context.width, 1500);
  assert.equal(effectiveRetractThreshold(1600, 1700), 1699);
});

test("a narrower monitor shrinks saved widths proportionally only enough to fit", () => {
  const layout = coupledWorkspaceLayout(
    { height: 700, left: 100, top: 20, width: 1200 },
    900,
    600,
  );
  assert.deepEqual(layout, {
    context: { height: 700, left: 760, top: 20, width: 440 },
    playhouse: { height: 700, left: 100, top: 20, width: 660 },
  });
});

test("coupled resizing enforces the PH and Aux minimum widths", () => {
  const layout = coupledWorkspaceLayout(
    { height: 900, left: 0, top: 0, width: 1600 },
    900,
    600,
    100,
  );
  assert.equal(layout.playhouse.width, 400);
  assert.equal(layout.context.width, 320);
  assert.equal(layout.playhouse.width + layout.context.width, 720);
});

test("invalid or swapped saved geometry falls back to the fresh 60/40 layout", () => {
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  assert.deepEqual(restoredWorkspaceLayout({
    contextBounds: { height: 900, left: 0, top: 0, width: 640 },
    layoutVersion: 2,
    monitorId: "display-1",
    playhouseBounds: { height: 900, left: 640, top: 0, width: 960 },
  }, workArea, "display-1"), defaultWorkspaceLayout(workArea));
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

test("Aux outer-edge resize proportionally updates both connected windows", async () => {
  const chrome = fakeChrome();
  const updates = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    nativeSetBounds: async (update) => {
      updates.push(update);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  const changedContext = { height: 900, id: opened.contextWindowId, left: 899, top: 0, width: 500 };
  chrome.resizeWindow(opened.contextWindowId, changedContext);

  const reconciled = await workspace.reconcileWorkspace(changedContext);

  assert.deepEqual(updates.at(-1).target, {
    context: { height: 900, left: 839, top: 0, width: 560 },
    playhouse: { height: 900, left: 0, top: 0, width: 839 },
  });
  assert.equal(reconciled.playhouseBounds.left + reconciled.playhouseBounds.width,
    reconciled.contextBounds.left);
  assert.equal(reconciled.playhouseBounds.top, reconciled.contextBounds.top);
  assert.equal(reconciled.playhouseBounds.height, reconciled.contextBounds.height);
  assert.equal(await workspace.reconcileWorkspace({
    ...updates.at(-1).target.context,
    id: opened.contextWindowId,
  }), null);
  assert.equal(updates.length, 1);
});

test("native live resize suppresses intermediate reconciliation and persists only settled bounds", async () => {
  const chrome = fakeChrome();
  const updates = [];
  const workspace = new CarnivalWorkspaceController(chrome, {
    nativeSetBounds: async (update) => {
      updates.push(update);
      return true;
    },
  });
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const opened = await workspace.summon(workArea, "display-1");
  workspace.setNativeResizeInProgress(true);
  const intermediate = { height: 900, id: opened.contextWindowId, left: 840, top: 0, width: 560 };
  chrome.resizeWindow(opened.contextWindowId, intermediate);

  assert.equal(await workspace.reconcileWorkspace(intermediate), null);
  assert.equal(await workspace.rememberVisibleBounds(), null);
  assert.equal(updates.length, 0);

  const settled = await workspace.completeNativeResize({
    context: { height: 900, left: 840, top: 0, width: 560 },
    playhouse: { height: 900, left: 0, top: 0, width: 840 },
  });

  assert.deepEqual(settled.savedVisibleBounds, {
    context: { height: 900, left: 840, top: 0, width: 560 },
    playhouse: { height: 900, left: 0, top: 0, width: 840 },
  });
});

test("PH resize and independent window movement reconcile to the anchored saved layout", async () => {
  const scenarios = [
    { role: "playhouse", bounds: { height: 900, left: 100, top: 20, width: 820 } },
    { role: "playhouse", bounds: { height: 900, left: 180, top: 20, width: 899 } },
    { role: "context", bounds: { height: 900, left: 1050, top: 20, width: 500 } },
  ];
  for (const { bounds, role } of scenarios) {
    const chrome = fakeChrome();
    const updates = [];
    const workspace = new CarnivalWorkspaceController(chrome, {
      nativeSetBounds: async (update) => {
        updates.push(update);
        return true;
      },
    });
    const workArea = { height: 900, left: 100, top: 20, width: 1600 };
    const opened = await workspace.summon(workArea, "display-1");
    const id = role === "playhouse" ? opened.playhouseWindowId : opened.contextWindowId;
    const changed = { ...bounds, id };
    chrome.resizeWindow(id, changed);

    await workspace.reconcileWorkspace(changed);

    assert.deepEqual(updates.at(-1).target, {
      context: { height: 900, left: 1000, top: 20, width: 600 },
      playhouse: { height: 900, left: 100, top: 20, width: 900 },
    });
  }
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
