import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceActions } from "./workspace-summon.js";

function harness() {
  const calls = [];
  const reports = [];
  const controller = {
    async retract() {
      calls.push({ type: "retract" });
      return { drawerState: "retracted" };
    },
    async state() {
      return { drawerState: "retracted" };
    },
    async summon(workArea, monitorId) {
      calls.push({ monitorId, type: "summon", workArea });
      return { drawerState: "open", monitorId, workArea };
    },
  };
  const actions = createWorkspaceActions({
    controller,
    logger: { info() {} },
    reportDrawerState(state) { reports.push(state); },
    validWorkArea(workArea) { return workArea?.width > 0 && workArea?.height > 0; },
  });
  return { actions, calls, reports };
}

test("native hot-corner summon acknowledges and opens a retracted workspace", async () => {
  const { actions, calls, reports } = harness();
  const replies = [];
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };

  await actions.handleNativeMessage(
    { monitorId: "windows-1", type: "summon", workArea },
    { postMessage(message) { replies.push(message); } },
  );

  assert.deepEqual(replies, [{ type: "summonAccepted" }]);
  assert.deepEqual(calls, [{ monitorId: "windows-1", type: "summon", workArea }]);
  assert.equal(reports.at(-1).drawerState, "open");
});

test("toolbar summon uses the same workspace action and coalesces an opening duplicate", async () => {
  const { actions, calls, reports } = harness();
  const display = {
    monitorId: "display-1",
    workArea: { height: 900, left: 0, top: 0, width: 1600 },
  };

  const first = actions.summon(display, "toolbar");
  const duplicate = actions.summon(display, "native hot corner");
  await Promise.all([first, duplicate]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "summon");
  assert.equal(reports.length, 1);
});
