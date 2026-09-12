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
    armedAt: createdAt,
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
  const result = await getPendingGmailDrag(storage, 31_001);
  assert.equal(result.status, "missing");
  assert.equal(result.reason, "expired");
  assert.equal(result.ageMs, 30_001);
});

test("armed drag remains available during a slow 20-second cross-window gesture", async () => {
  const storage = sessionStorage();
  await storePendingGmailDrag(storage, pending());
  const result = await getPendingGmailDrag(storage, 21_000);
  assert.equal(result.status, "found");
  assert.equal(result.ageMs, 20_000);
});

test("only armed records are retrievable and a new drag replaces an older drag", async () => {
  const storage = sessionStorage();
  const unarmed = { ...pending(), armedAt: undefined };
  await storePendingGmailDrag(storage, unarmed);
  assert.deepEqual(await getPendingGmailDrag(storage, 2_000), {
    reason: "not-armed",
    status: "missing",
  });
  await storePendingGmailDrag(storage, pending());
  await storePendingGmailDrag(storage, {
    ...pending(2_000),
    actionId: "action-b",
    threadRef: "thread-b",
  });
  const result = await getPendingGmailDrag(storage, 3_000);
  assert.equal(result.record.actionId, "action-b");
  assert.equal(result.record.threadRef, "thread-b");
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
