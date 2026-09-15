import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyWindowTraceUrl,
  createWindowTrace,
  WINDOW_TRACE_CURRENT_KEY,
  WINDOW_TRACE_EVENT_LIMIT,
  WINDOW_TRACE_LATEST_KEY,
  WINDOW_TRACE_LIFECYCLE_KEY,
} from "./window-trace.js";

function harness(seed = {}) {
  const lines = [];
  const scheduled = [];
  const storage = { ...seed };
  const workspaceState = {
    auxWindowId: 2,
    contextBounds: { height: 900, left: 900, top: 0, width: 600 },
    drawerState: "open",
    phWindowId: 1,
    playhouseBounds: { height: 900, left: 0, top: 0, width: 900 },
    oauthToken: "super-secret-must-not-appear",
  };
  const windows = [{
    focused: true,
    height: 900,
    id: 1,
    left: 0,
    state: "normal",
    tabs: [{ active: true, id: 10, status: "complete", url: "https://carnival-playhouse.vercel.app/?view=today" }],
    top: 0,
    type: "normal",
    width: 900,
  }];
  const chromeApi = {
    storage: {
      local: {
        async get(key) {
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.flatMap((name) => (
            name === "carnivalDesktopWorkspace"
              ? [[name, workspaceState]]
              : Object.hasOwn(storage, name) ? [[name, storage[name]]] : []
          )));
        },
        async remove(keys) { for (const key of keys) delete storage[key]; },
        async set(values) { Object.assign(storage, values); },
      },
      session: { async get() { return {}; } },
    },
    windows: {
      async get(id) {
        const window = windows.find((candidate) => candidate.id === id);
        if (!window) throw new Error("missing window");
        return window;
      },
      async getAll() { return windows; },
    },
  };
  const trace = createWindowTrace({
    chromeApi,
    getNativeState: () => ({ connected: true }),
    logger: { error(line) { lines.push(line); }, info(line) { lines.push(line); } },
    now: () => new Date("2026-09-15T01:02:03.456Z"),
    randomId: () => "trace-test",
    schedule(callback, delay) { scheduled.push({ callback, delay }); },
  });
  return { lines, scheduled, storage, trace, windows };
}

test("window trace records startup state, discovery, creation, concurrency, and final summary", async () => {
  const { lines, scheduled, trace, windows } = harness();
  await trace.start("toolbar");
  trace.workspaceStartRequest("toolbar");
  trace.enter("workspace", { source: "test" });
  trace.enter("workspace", { source: "test" });
  await trace.discovery("PLAYHOUSE", 1);
  const callId = await trace.beforeCreate({
    bounds: { height: 900, left: 900, top: 0, width: 600 },
    kind: "context",
    reason: "test-create",
    urls: ["https://calendar.google.com/calendar/u/0/r"],
  });
  const aux = {
    focused: false,
    height: 900,
    id: 2,
    left: 900,
    state: "normal",
    tabs: [{ active: true, id: 20, status: "loading", url: "https://calendar.google.com/calendar/u/0/r" }],
    top: 0,
    type: "normal",
    width: 600,
  };
  windows.push(aux);
  trace.chromeWindowCreated(aux);
  trace.afterCreate(callId, "context", aux);
  trace.exit("workspace", { source: "test" });
  trace.exit("workspace", { source: "test" });
  await scheduled.find(({ delay }) => delay === 100).callback();
  await scheduled.find(({ delay }) => delay === 5000).callback();

  const events = trace.records.map(({ event }) => event);
  assert.ok(events.includes("SAVED_WINDOW_STATE"));
  assert.ok(events.includes("WINDOW_SNAPSHOT"));
  assert.ok(events.includes("PLAYHOUSE_DISCOVERY_START"));
  assert.ok(events.includes("PLAYHOUSE_DISCOVERY_RESULT"));
  assert.ok(events.includes("WINDOW_CREATE_CALL"));
  assert.ok(events.includes("CREATE_WINDOW_FROM_TABS_ENTER"));
  assert.ok(events.includes("WINDOW_CREATE_RESULT"));
  assert.ok(events.includes("CHROME_WINDOW_ON_CREATED"));
  assert.ok(events.includes("CONCURRENT_STARTUP_DETECTED"));
  assert.ok(events.includes("CARNIVAL_WINDOW_TRACE_SUMMARY"));
  assert.ok(lines.every((line) => line.startsWith("CARNIVAL_WINDOW_TRACE ")));
  assert.ok(lines.every((line) => !line.includes("super-secret-must-not-appear")));
  assert.ok(trace.records.every(({ seq, startupTraceId, timestamp }) => (
    Number.isInteger(seq) && startupTraceId === "WT-trace-test" && timestamp.endsWith(".456Z")
  )));
});

test("cold-start lifecycle and trace persist across a worker restart and dump chronologically", async () => {
  const first = harness();
  await first.trace.workerLoaded();
  await first.trace.runtimeStartup();
  await first.trace.start("native hot corner");
  first.trace.workspaceStartRequest("native hot corner");
  first.trace.tabMove({
    classification: "PLAYHOUSE",
    fromWindowId: 7,
    tabId: 70,
    toWindowId: 8,
  });
  await first.scheduled.find(({ delay }) => delay === 5000).callback();

  assert.equal(first.storage[WINDOW_TRACE_CURRENT_KEY].traceId, "WT-trace-test");
  assert.equal(first.storage[WINDOW_TRACE_LATEST_KEY].summary.startupMode, "COLD");
  assert.ok(first.storage[WINDOW_TRACE_LATEST_KEY].events.some(
    ({ event }) => event === "EXTENSION_WORKER_LOADED",
  ));
  assert.ok(first.storage[WINDOW_TRACE_LATEST_KEY].events.some(
    ({ event }) => event === "CHROME_RUNTIME_ON_STARTUP",
  ));
  assert.ok(first.storage[WINDOW_TRACE_LATEST_KEY].events.some(
    ({ event }) => event === "WORKSPACE_START_REQUEST",
  ));
  assert.ok(first.storage[WINDOW_TRACE_LATEST_KEY].events.some(
    ({ event }) => event === "TAB_MOVE_CALL",
  ));

  const restarted = harness(first.storage);
  await restarted.trace.dump();
  const begin = restarted.lines.indexOf("CARNIVAL_WINDOW_TRACE_BEGIN");
  const end = restarted.lines.indexOf("CARNIVAL_WINDOW_TRACE_END");
  assert.ok(begin >= 0 && end > begin);
  assert.ok(restarted.lines.slice(begin, end).some((line) => (
    line.startsWith("CARNIVAL_WINDOW_TRACE_SUMMARY ")
  )));
});

test("trace storage is bounded, excludes unknown saved fields, and clear removes only trace keys", async () => {
  const instance = harness({ unrelatedSetting: { keep: true } });
  await instance.trace.start("toolbar");
  for (let index = 0; index < WINDOW_TRACE_EVENT_LIMIT + 25; index += 1) {
    instance.trace.workspaceStartRequest(`request-${index}`);
  }
  await instance.trace.dump();

  const current = instance.storage[WINDOW_TRACE_CURRENT_KEY];
  assert.equal(current.events.length, WINDOW_TRACE_EVENT_LIMIT);
  assert.equal(JSON.stringify(current).includes("super-secret-must-not-appear"), false);
  await instance.trace.clear();
  assert.equal(instance.storage[WINDOW_TRACE_CURRENT_KEY], undefined);
  assert.equal(instance.storage[WINDOW_TRACE_LATEST_KEY], undefined);
  assert.equal(instance.storage[WINDOW_TRACE_LIFECYCLE_KEY], undefined);
  assert.deepEqual(instance.storage.unrelatedSetting, { keep: true });
});

test("trace records a window role transition after relevant tab navigation", async () => {
  const instance = harness();
  await instance.trace.start("toolbar");
  instance.windows[0].tabs[0].url = "https://mail.google.com/mail/u/0/#inbox";
  await instance.trace.tabEvent("CHROME_TAB_ON_UPDATED", {
    active: true,
    id: 10,
    status: "complete",
    url: "https://mail.google.com/mail/u/0/#inbox",
    windowId: 1,
  });

  const transition = instance.trace.records.find(({ event }) => event === "WINDOW_ROLE_CHANGED");
  assert.deepEqual(
    { from: transition?.from, to: transition?.to, windowId: transition?.windowId },
    { from: "PLAYHOUSE", to: "AUX", windowId: 1 },
  );
});

test("window trace exposes only classifications and safe hostnames, never arbitrary URL details", () => {
  assert.deepEqual(
    classifyWindowTraceUrl("https://example.com/private/path?token=super-secret"),
    { classification: "OTHER", hostname: "example.com" },
  );
  assert.deepEqual(
    classifyWindowTraceUrl("https://carnival-playhouse.vercel.app/?view=today"),
    { classification: "PLAYHOUSE" },
  );
  assert.deepEqual(
    classifyWindowTraceUrl("https://mail.google.com/mail/u/0/#inbox"),
    { classification: "AUX", hostname: "mail.google.com" },
  );
});
