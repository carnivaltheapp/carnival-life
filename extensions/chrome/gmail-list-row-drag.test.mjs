import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeGmailListRowDrag,
  getGmailListRowDrag,
  storeGmailListRowDrag,
} from "./gmail-list-row-drag.js";

function sessionStorage() {
  const values = {};
  return {
    async get(key) { return { [key]: values[key] }; },
    async remove(key) { delete values[key]; },
    async set(next) { Object.assign(values, next); },
  };
}

test("list-row drag metadata remains available across the cross-window drop", async () => {
  const storage = sessionStorage();
  const payload = {
    correlationId: "drag-1",
    gmailApiThreadId: "api-thread-1",
    gmailApiThreadStrategy: "direct",
    gmailDragSource: "list_row",
    subject: "List subject",
    url: "https://mail.google.com/mail/u/0/#all/%23thread-f%3A123",
  };
  await storeGmailListRowDrag(storage, payload, 1_000);
  assert.deepEqual(await getGmailListRowDrag(storage, 2_000), {
    payload,
    status: "found",
  });
  assert.deepEqual(await consumeGmailListRowDrag(storage, "drag-1", 2_001), {
    status: "consumed",
  });
  assert.equal((await getGmailListRowDrag(storage)).status, "missing");
});

test("list-row drag metadata expires after ten seconds", async () => {
  const storage = sessionStorage();
  await storeGmailListRowDrag(storage, { correlationId: "drag-1" }, 1_000);
  assert.deepEqual(await getGmailListRowDrag(storage, 11_001), {
    reason: "expired",
    status: "missing",
  });
});
