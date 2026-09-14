import assert from "node:assert/strict";
import test from "node:test";

import {
  isOpenInAuxMessage,
  OPEN_IN_AUX_MESSAGE_TYPE,
  routeOpenInAuxMessage,
} from "./aux-routing.js";

test("background recognizes the canonical openInAux runtime message", () => {
  assert.equal(isOpenInAuxMessage({ type: OPEN_IN_AUX_MESSAGE_TYPE }), true);
  assert.equal(isOpenInAuxMessage({ type: "openCarnivalContext" }), false);
});

test("background routing hands the URL to the existing Aux controller", async () => {
  const calls = [];
  const state = { contextTabId: 12, contextWindowId: 2, drawerState: "open" };
  await routeOpenInAuxMessage({
    controller: {
      async openCarnivalContext(url, workArea, monitorId, role) {
        calls.push({ monitorId, role, url, workArea });
      },
      async state() { return state; },
    },
    currentWorkArea: async () => ({
      monitorId: "display-1",
      workArea: { height: 900, left: 0, top: 0, width: 1600 },
    }),
    logger: { info() {} },
    message: { type: OPEN_IN_AUX_MESSAGE_TYPE, url: "https://example.com/context" },
    reportDrawerState(value) { calls.push({ state: value }); },
  });

  assert.deepEqual(calls, [
    {
      monitorId: "display-1",
      role: "misc",
      url: "https://example.com/context",
      workArea: { height: 900, left: 0, top: 0, width: 1600 },
    },
    { state },
  ]);
});

test("background preserves the existing window arrangement for Description routing", async () => {
  const calls = [];
  await routeOpenInAuxMessage({
    controller: {
      async openCarnivalContext(url, workArea, monitorId, role, options) {
        calls.push({ monitorId, options, role, url, workArea });
      },
      async state() { return { drawerState: "open" }; },
    },
    currentWorkArea: async () => ({
      monitorId: "display-1",
      workArea: { height: 900, left: 0, top: 0, width: 1600 },
    }),
    logger: { info() {} },
    message: {
      existingAuxOnly: true,
      type: OPEN_IN_AUX_MESSAGE_TYPE,
      url: "https://app.slack.com/client/T1/C1",
    },
    reportDrawerState() {},
  });
  assert.deepEqual(calls[0].options, { existingAuxOnly: true });
});
