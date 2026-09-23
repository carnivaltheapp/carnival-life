import assert from "node:assert/strict";
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
