import assert from "node:assert/strict";
import test from "node:test";

import { classifyWindowTraceUrl, createWindowTrace } from "./window-trace.js";

function harness() {
  const lines = [];
  const scheduled = [];
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
          return key === "carnivalDesktopWorkspace"
            ? { carnivalDesktopWorkspace: workspaceState }
            : {};
        },
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
    logger: { info(line) { lines.push(line); } },
    now: () => new Date("2026-09-15T01:02:03.456Z"),
    randomId: () => "trace-test",
    schedule(callback, delay) { scheduled.push({ callback, delay }); },
  });
  return { lines, scheduled, trace, windows };
}

test("window trace records startup state, discovery, creation, concurrency, and final summary", async () => {
  const { lines, scheduled, trace, windows } = harness();
  await trace.start("toolbar");
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
