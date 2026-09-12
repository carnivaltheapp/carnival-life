import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./gmail-playhouse-content.js", import.meta.url), "utf8");

function dataTransfer(values = {}) {
  const stored = new Map(Object.entries(values));
  return {
    effectAllowed: "copy",
    dropEffect: "none",
    get types() { return [...stored.keys()]; },
    getData: (type) => stored.get(type) ?? "",
  };
}

function playhouseEnvironment(pendingRecords) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const runtimeMessages = [];
  const diagnostics = [];
  const handoffs = [];
  class TestElement {
    constructor(playId = null) { this.playId = playId; this.attributes = new Map(); }
    closest() { return this.playId ? this : null; }
    getAttribute(attribute) { return attribute === "data-play-row-id" ? this.playId : null; }
    removeAttribute(attribute) { this.attributes.delete(attribute); }
    setAttribute(attribute, value) { this.attributes.set(attribute, value); }
  }
  class TestCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init.detail; }
  }
  const row = new TestElement("play-under-pointer");
  const overlay = new TestElement();
  const queue = [...pendingRecords];
  const context = {
    CustomEvent: TestCustomEvent,
    Element: TestElement,
    chrome: {
      runtime: {
        id: "extension-id",
        sendMessage: async (message) => {
          runtimeMessages.push(message);
          if (message.type === "getPendingGmailDrag") return { pending: queue.shift() ?? null };
          return { ok: true };
        },
      },
    },
    console: {
      info: (event, details) => diagnostics.push({ details, event }),
      warn: (event, details) => diagnostics.push({ details, event }),
    },
    document: {
      addEventListener: (type, listener) => documentListeners.set(type, listener),
      elementFromPoint: () => row,
    },
    window: {
      addEventListener: (type, listener) => windowListeners.set(type, listener),
      dispatchEvent: (event) => {
        if (event.type === "carnival:gmail-drop") {
          const detail = JSON.parse(event.detail);
          handoffs.push(detail);
          windowListeners.get("carnival:gmail-drop-handoff")?.(new TestCustomEvent(
            "carnival:gmail-drop-handoff",
            { detail: JSON.stringify({ accepted: true, actionId: detail.actionId }) },
          ));
        } else {
          windowListeners.get(event.type)?.(event);
        }
      },
    },
  };
  vm.runInNewContext(source, context);
  return { diagnostics, documentListeners, handoffs, overlay, row, runtimeMessages };
}

function pending(actionId) {
  return {
    actionId,
    armedAt: 1_010,
    canonicalUrl: `https://mail.google.com/mail/u/0/#all/${actionId}`,
    createdAt: 1_000,
    gmailAccountIndex: 0,
    threadContext: {
      from: { email: "sender@example.test", name: "Sender" },
      to: [{ email: "self@example.test", name: "Self" }],
    },
    threadRef: actionId,
  };
}

async function performDrop(environment, transfer = dataTransfer()) {
  const { documentListeners, overlay } = environment;
  const entranceTransfer = dataTransfer({
    "text/uri-list": "https://mail.google.com/mail/u/0/#all/thread",
  });
  documentListeners.get("dragenter")({ dataTransfer: entranceTransfer, target: overlay });
  let dragoverPrevented = false;
  documentListeners.get("dragover")({
    clientX: 5,
    clientY: 5,
    dataTransfer: entranceTransfer,
    preventDefault: () => { dragoverPrevented = true; },
    target: overlay,
  });
  let dropPrevented = false;
  documentListeners.get("drop")({
    clientX: 5,
    clientY: 5,
    dataTransfer: transfer,
    preventDefault: () => { dropPrevented = true; },
    stopImmediatePropagation() {},
    target: overlay,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { dragoverPrevented, dropPrevented };
}

test("PlayHouse accepts an empty-transfer drop and resolves the exact row under the pointer", async () => {
  const environment = playhouseEnvironment([pending("action-1")]);
  const result = await performDrop(environment);
  assert.equal(result.dragoverPrevented, true);
  assert.equal(result.dropPrevented, true);
  assert.equal(environment.handoffs[0].playId, "play-under-pointer");
  assert.equal(environment.handoffs[0].actionId, "action-1");
  assert.equal(environment.runtimeMessages.filter(({ type }) => type === "getPendingGmailDrag").length, 1);
  assert.equal(environment.runtimeMessages.filter(({ type }) => type === "consumePendingGmailDrag").length, 1);
});

test("ten consecutive cross-window drops use ten fresh pending records", async () => {
  const records = Array.from({ length: 10 }, (_, index) => pending(`action-${index}`));
  const environment = playhouseEnvironment(records);
  for (let index = 0; index < 10; index += 1) await performDrop(environment);
  assert.deepEqual(environment.handoffs.map(({ actionId }) => actionId),
    records.map(({ actionId }) => actionId));
  assert.equal(environment.runtimeMessages.filter(({ type }) => type === "getPendingGmailDrag").length, 10);
  assert.equal(environment.runtimeMessages.filter(({ type }) => type === "consumePendingGmailDrag").length, 10);
});

test("internal Play drag remains untouched", () => {
  const environment = playhouseEnvironment([]);
  let prevented = false;
  environment.documentListeners.get("dragover")({
    dataTransfer: dataTransfer({ "text/plain": "play-1,play-2" }),
    preventDefault: () => { prevented = true; },
    target: environment.row,
  });
  assert.equal(prevented, false);
});

test("stale PlayHouse content script reports invalidation without throwing", () => {
  const diagnostics = [];
  const windowListeners = new Map();
  class TestCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  }
  assert.doesNotThrow(() => vm.runInNewContext(source, {
    CustomEvent: TestCustomEvent,
    Element: class {},
    chrome: { runtime: { get id() { throw new Error("Extension context invalidated."); } } },
    console: { info() {}, warn: (event) => diagnostics.push(event) },
    document: { addEventListener() {} },
    window: { addEventListener: (type, listener) => windowListeners.set(type, listener) },
  }));
  windowListeners.get("carnival:gmail-diagnostic")(new TestCustomEvent(
    "carnival:gmail-diagnostic",
    { detail: JSON.stringify({ event: "GMAIL_TEST_EVENT" }) },
  ));
  assert.deepEqual(diagnostics, ["GMAIL_EXTENSION_CONTEXT_INVALIDATED"]);
});
