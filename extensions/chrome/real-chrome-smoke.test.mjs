import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { chromium } from "@playwright/test";

const extensionPath = dirname(fileURLToPath(import.meta.url));
const forbiddenRuntimeError = /Cannot read properties of undefined|chrome\.runtime|sendMessage|Extension context invalidated|Unchecked runtime\.lastError/i;

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", () => resolveListen(server.address().port));
  });
}

async function bridgeRequest(page, origin, requestId) {
  return page.evaluate(({ origin: expectedOrigin, requestId: id }) => (
    new Promise((resolveRequest) => {
      const timeout = setTimeout(() => resolveRequest({ timeout: true }), 8000);
      function receive(event) {
        if (event.origin !== expectedOrigin || event.data?.requestId !== id ||
          event.data?.type !== "carnivalBridgeHealthResult") return;
        clearTimeout(timeout);
        window.removeEventListener("message", receive);
        resolveRequest(event.data);
      }
      window.addEventListener("message", receive);
      window.postMessage({
        requestId: id,
        source: "carnival-playhouse",
        type: "carnivalBridgeHealth",
      }, expectedOrigin);
    })
  ), { origin, requestId });
}

test("real Chromium loads the unpacked extension and safely bridges runtime messages", {
  timeout: 90_000,
}, async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>PlayHouse extension smoke</title><main>ready</main>");
  });
  const port = await listen(server);
  const origin = `http://localhost:${port}`;
  const profile = await mkdtemp(resolve(tmpdir(), "carnival-extension-smoke-"));
  const runtimeErrors = [];
  const pageLogs = [];
  const workerLogs = [];
  let context;

  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const worker = context.serviceWorkers()[0] ??
      await context.waitForEvent("serviceworker", { timeout: 15_000 });
    worker.on("console", (message) => {
      const text = message.text();
      workerLogs.push(text);
      if (message.type() === "error" && forbiddenRuntimeError.test(text)) runtimeErrors.push(text);
    });
    worker.on("close", () => workerLogs.push("WORKER_CLOSED"));
    assert.match(worker.url(), /^chrome-extension:\/\/[^/]+\/background\.js$/);

    context.on("page", (candidate) => {
      candidate.on("pageerror", (error) => runtimeErrors.push(error.message));
      candidate.on("console", (message) => {
        const text = message.text();
        if (message.type() === "error" && forbiddenRuntimeError.test(text)) runtimeErrors.push(text);
      });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      pageLogs.push(message.text());
      if (message.type() === "error" && forbiddenRuntimeError.test(message.text())) {
        runtimeErrors.push(message.text());
      }
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("main")?.textContent === "ready");
    await page.waitForTimeout(250);
    assert.ok(pageLogs.some((message) => message.includes("Carnival Aux bridge content script loaded")));

    const routed = await bridgeRequest(page, origin, "real-bridge-1");
    assert.equal(routed.ok, true);
    assert.equal(routed.timeout, undefined);
    assert.deepEqual(runtimeErrors, []);

    await worker.evaluate(() => globalThis.chrome.runtime.reload()).catch(() => {});
    await page.waitForTimeout(250);
    const stale = await bridgeRequest(page, origin, "stale-route-1");
    assert.deepEqual(stale, {
      ok: false,
      requestId: "stale-route-1",
      source: "carnival-playhouse-bridge",
      type: "carnivalBridgeHealthResult",
    });
    assert.deepEqual(runtimeErrors, []);
  } finally {
    await context?.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(profile, { force: true, recursive: true });
  }
});
