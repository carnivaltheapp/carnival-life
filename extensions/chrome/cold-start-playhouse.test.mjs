import assert from "node:assert/strict";
import test from "node:test";

import { waitForColdStartPlayhouse } from "./cold-start-playhouse.js";

function event() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    emit(...args) { for (const listener of listeners) listener(...args); },
    removeListener(listener) { listeners.delete(listener); },
  };
}

function harness({ secondTab = false } = {}) {
  const events = [];
  const timers = [];
  const tabUpdated = event();
  const tabRemoved = event();
  const windowRemoved = event();
  const window = {
    focused: true,
    id: 1,
    tabs: [
      { active: true, id: 10, status: "loading", url: "about:blank", windowId: 1 },
      ...(secondTab
        ? [{ active: false, id: 11, status: "complete", url: "https://example.com/", windowId: 1 }]
        : []),
    ],
    type: "normal",
  };
  const windows = new Map([[1, window]]);
  const chromeApi = {
    tabs: { onRemoved: tabRemoved, onUpdated: tabUpdated },
    windows: {
      async getAll() { return [...windows.values()]; },
      onRemoved: windowRemoved,
    },
  };
  function navigate(url, status = "complete") {
    window.tabs[0] = { ...window.tabs[0], status, url };
    tabUpdated.emit(10, { status, url }, window.tabs[0]);
  }
  return {
    chromeApi,
    events,
    navigate,
    get timerCount() { return timers.length; },
    runTimeout() { timers[0]?.callback(); },
    setTimer(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    window,
  };
}

async function settleUntil(predicate) {
  for (let attempt = 0; attempt < 10 && !predicate(); attempt += 1) await Promise.resolve();
  assert.equal(predicate(), true);
}

function wait(instance, overrides = {}) {
  return waitForColdStartPlayhouse({
    candidateWindowIds: [1],
    chromeApi: instance.chromeApi,
    clearTimer() {},
    onEvent(eventName, details) { instance.events.push({ details, eventName }); },
    setTimer: instance.setTimer,
    timeoutMs: 3500,
    ...overrides,
  });
}

test("unresolved cold-start tab resolves to PlayHouse and its window is adopted", async () => {
  const instance = harness();
  const adoption = wait(instance);
  await settleUntil(() => instance.timerCount === 1);
  instance.navigate("https://carnival-playhouse.vercel.app/?view=today");

  const result = await adoption;
  assert.equal(result.window.id, 1);
  assert.equal(result.tab.id, 10);
  assert.deepEqual(instance.events.map(({ eventName }) => eventName), [
    "COLD_START_CANDIDATE_FOUND",
    "COLD_START_CANDIDATE_WAITING",
    "COLD_START_CANDIDATE_RESOLVED_PLAYHOUSE",
  ]);
});

test("resolved non-PlayHouse candidate is rejected", async () => {
  const instance = harness();
  const adoption = wait(instance);
  await settleUntil(() => instance.timerCount === 1);
  instance.navigate("https://example.com/ordinary");

  assert.equal(await adoption, null);
  assert.equal(instance.events.at(-1).eventName, "COLD_START_CANDIDATE_REJECTED");
});

test("unresolved candidate uses a bounded timeout", async () => {
  const instance = harness();
  const adoption = wait(instance);
  await settleUntil(() => instance.timerCount === 1);
  instance.runTimeout();

  assert.equal(await adoption, null);
  assert.equal(instance.events.at(-1).eventName, "COLD_START_CANDIDATE_TIMEOUT");
});

test("PlayHouse tab may coexist with an unrelated tab in the adopted startup window", async () => {
  const instance = harness({ secondTab: true });
  const adoption = wait(instance);
  await settleUntil(() => instance.timerCount === 1);
  instance.navigate("https://carnival-playhouse.vercel.app/");

  const result = await adoption;
  assert.equal(result.window.tabs.length, 2);
  assert.equal(result.window.tabs[1].url, "https://example.com/");
});

test("only recorded startup window IDs are eligible", async () => {
  const instance = harness();
  assert.equal(await wait(instance, { candidateWindowIds: [99] }), null);
  assert.equal(instance.events.at(-1).details.reason, "no-unresolved-startup-candidate");
});
