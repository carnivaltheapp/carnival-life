import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./extension-messaging.js", import.meta.url), "utf8");
const recoveryMessage = "Carnival extension was reloaded. Refresh PlayHouse.";

function load(chrome, warnings = []) {
  const context = { chrome, console: { warn: (...values) => warnings.push(values) } };
  vm.runInNewContext(source, context);
  return context.CarnivalExtensionMessaging;
}

test("normalizes successful and missing responses", async () => {
  const successful = load({ runtime: { sendMessage: async () => ({ ok: true, value: 1 }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(await successful.send({ type: "test" }))), {
    ok: true,
    response: { ok: true, value: 1 },
  });
  const missing = load({ runtime: { sendMessage: async () => undefined } });
  assert.equal((await missing.send({})).code, "MISSING_RESPONSE");
});

test("handles missing runtime and synchronous invalidation without throwing", async () => {
  const unavailable = load(undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(await unavailable.send({}))), {
    code: "EXTENSION_CONTEXT_UNAVAILABLE",
    message: recoveryMessage,
    ok: false,
  });
  const invalidated = load({ runtime: { sendMessage() { throw new Error("Extension context invalidated."); } } });
  assert.deepEqual(JSON.parse(JSON.stringify(await invalidated.send({}))), {
    code: "EXTENSION_CONTEXT_UNAVAILABLE",
    message: recoveryMessage,
    ok: false,
  });
});

test("handles rejected promises, runtime.lastError, and malformed responses", async () => {
  const rejected = load({ runtime: { sendMessage: async () => { throw new Error("port closed"); } } });
  assert.equal((await rejected.send({})).code, "RUNTIME_MESSAGE_FAILED");

  const runtime = {
    lastError: { message: "message port closed" },
    sendMessage(_message, callback) { callback(undefined); },
  };
  assert.equal((await load({ runtime }).send({})).code, "RUNTIME_MESSAGE_FAILED");
  assert.equal((await load({ runtime: { sendMessage: async () => "bad" } }).send({})).code,
    "MALFORMED_RESPONSE");
});

test("reports each formatted failure once without object coercion", () => {
  const warnings = [];
  const messaging = load(undefined, warnings);
  const result = { code: "TEST", message: "Readable failure", ok: false };
  messaging.reportFailureOnce("Bridge", result);
  messaging.reportFailureOnce("Bridge", result);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "Bridge: Readable failure");
  assert.doesNotMatch(warnings[0][0], /\[object Object\]/);
});
