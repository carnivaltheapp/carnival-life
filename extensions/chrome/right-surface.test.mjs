import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isToggleRightSurfaceMessage,
  TOGGLE_RIGHT_SURFACE_MESSAGE_TYPE,
  toggleRightSurface,
} from "./right-surface.js";

test("right-surface messages are recognized narrowly", () => {
  assert.equal(isToggleRightSurfaceMessage({ type: TOGGLE_RIGHT_SURFACE_MESSAGE_TYPE }), true);
  assert.equal(isToggleRightSurfaceMessage({ type: "openInAux" }), false);
  assert.equal(isToggleRightSurfaceMessage(null), false);
});

test("right-surface command reuses the controller and reports its resulting state", async () => {
  const workArea = { height: 900, left: 0, top: 0, width: 1600 };
  const expected = { rightSurface: "misc" };
  const calls = [];
  const result = await toggleRightSurface({
    controller: {
      async toggleRightSurface(received) {
        calls.push(["toggle", received]);
        return expected;
      },
    },
    async currentWorkArea() { return { workArea }; },
    reportDrawerState(state) { calls.push(["report", state]); },
  });

  assert.equal(result, expected);
  assert.deepEqual(calls, [["toggle", workArea], ["report", expected]]);
});

test("shared toggle follows logical rightSurface in both directions", async () => {
  let rightSurface = "aux";
  const reports = [];
  const dependencies = {
    controller: {
      async toggleRightSurface() {
        rightSurface = rightSurface === "aux" ? "misc" : "aux";
        return { rightSurface };
      },
    },
    async currentWorkArea() {
      return { workArea: { height: 900, left: 0, top: 0, width: 1600 } };
    },
    reportDrawerState(state) { reports.push(state.rightSurface); },
  };

  assert.equal((await toggleRightSurface(dependencies)).rightSurface, "misc");
  assert.equal((await toggleRightSurface(dependencies)).rightSurface, "aux");
  assert.deepEqual(reports, ["misc", "aux"]);
});

test("toolbar, keyboard, and PlayHouse bridge reuse one toggle invocation without summoning", () => {
  const background = readFileSync(new URL("./background.js", import.meta.url), "utf8");
  const actionStart = background.indexOf("chrome.action.onClicked.addListener");
  const actionEnd = background.indexOf("chrome.windows.onCreated.addListener", actionStart);
  const action = background.slice(actionStart, actionEnd);
  const commandStart = background.indexOf("chrome.commands.onCommand.addListener");
  const commandEnd = background.indexOf("chrome.tabs.onRemoved.addListener", commandStart);
  const command = background.slice(commandStart, commandEnd);
  const messageStart = background.indexOf("if (isToggleRightSurfaceMessage(message))");
  const messageEnd = background.indexOf("if (message?.type === UNSTAR_GMAIL_THREAD)", messageStart);
  const message = background.slice(messageStart, messageEnd);
  const sharedStart = background.indexOf("function toggleCurrentRightSurface()");
  const sharedEnd = background.indexOf("function connectNativeHost()", sharedStart);
  const shared = background.slice(sharedStart, sharedEnd);

  assert.match(action, /addListener\(\(\) =>/);
  assert.equal(action.match(/toggleCurrentRightSurface\(\)/g)?.length, 1);
  assert.doesNotMatch(action, /summon|workspaceActions/);
  assert.equal(command.match(/toggleCurrentRightSurface\(\)/g)?.length, 1);
  assert.equal(message.match(/toggleCurrentRightSurface\(\)/g)?.length, 1);
  assert.equal(shared.match(/toggleRightSurface\(/g)?.length, 1);
});
