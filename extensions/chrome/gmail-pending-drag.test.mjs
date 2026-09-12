import assert from "node:assert/strict";
import test from "node:test";

import {
  consumePendingGmailDrag,
  getPendingGmailDrag,
  storePendingGmailDrag,
} from "./gmail-pending-drag.js";

function sessionStorage() {
  const values = {};
  return {
    async get(key) { return { [key]: values[key] }; },
    async set(next) { Object.assign(values, next); },
  };
}

function pending(createdAt = 1_000) {
  return {
    actionId: "action-a",
    canonicalUrl: "https://mail.google.com/mail/u/0/#all/thread-a",
    createdAt,
    gmailAccountIndex: 0,
    threadContext: {
      from: { email: "sender@example.test", name: "Sender" },
      to: [{ email: "self@example.test", name: "Self" }],
    },
    threadRef: "thread-a",
  };
}

test("session-backed pending drag survives service-worker state loss", async () => {
  const storage = sessionStorage();
  await storePendingGmailDrag(storage, pending());
  const restartedWorkerResult = await getPendingGmailDrag(storage, 2_000);
  assert.equal(restartedWorkerResult.status, "found");
  assert.equal(restartedWorkerResult.record.actionId, "action-a");
  assert.equal(restartedWorkerResult.record.threadRef, "thread-a");
  assert.deepEqual(restartedWorkerResult.record.threadContext, pending().threadContext);
});

test("GET does not consume pending drag but successful handoff consumption does", async () => {
  const storage = sessionStorage();
  await storePendingGmailDrag(storage, pending());
  assert.equal((await getPendingGmailDrag(storage, 2_000)).status, "found");
  assert.equal((await getPendingGmailDrag(storage, 2_001)).status, "found");
  assert.equal((await consumePendingGmailDrag(storage, "action-a", 2_002)).status, "consumed");
  assert.deepEqual(await getPendingGmailDrag(storage, 2_002), {
    reason: "already-consumed",
    status: "missing",
  });
});

test("expired pending drag reports its explicit TTL reason", async () => {
  const storage = sessionStorage();
  await storePendingGmailDrag(storage, pending());
  const result = await getPendingGmailDrag(storage, 11_001);
  assert.equal(result.status, "missing");
  assert.equal(result.reason, "expired");
  assert.equal(result.ageMs, 10_001);
});

test("missing and failed session storage reads report distinct reasons", async () => {
  assert.deepEqual(await getPendingGmailDrag(sessionStorage()), {
    reason: "never-stored",
    status: "missing",
  });
  assert.deepEqual(await getPendingGmailDrag({ get: async () => { throw new Error("failed"); } }), {
    reason: "storage-read-failed",
    status: "missing",
  });
});
