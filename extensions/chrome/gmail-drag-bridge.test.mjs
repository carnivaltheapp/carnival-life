import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridgeSource = await readFile(new URL("./gmail-drag-bridge.js", import.meta.url), "utf8");

function dataTransfer(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getData: (type) => values.get(type) ?? "",
    setData: (type, value) => values.set(type, value),
    get types() { return [...values.keys()]; },
    values,
  };
}

test("manifest injects Gmail drag normalization into Gmail and PlayHouse", async () => {
  const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.content_scripts.some((script) =>
    script.matches.includes("https://mail.google.com/*") &&
    script.js.includes("gmail-drag-bridge.js")
  ));
  assert.ok(manifest.content_scripts.some((script) =>
    script.matches.includes("https://carnival-playhouse.vercel.app/*") &&
    script.js.includes("gmail-drag-bridge.js")
  ));
});

test("Gmail pointer gesture enables native drag and adds transferable payloads", async () => {
  const listeners = new Map();
  const diagnostics = [];
  const messages = [];
  const transfer = dataTransfer();
  const participant = (email, name) => ({
    getAttribute: (attribute) => attribute === "email" ? email : attribute === "name" ? name : null,
    textContent: name,
  });
  const from = participant("me@example.com", "Me");
  const kayla = participant("kayla@example.com", "Kayla");
  class GmailMessageElement {
    constructor() { this.attributes = new Map(); }
    closest() { return this; }
    getAttribute(attribute) { return this.attributes.get(attribute) ?? null; }
    querySelector(selector) {
      return selector.startsWith(".gD")
        ? from
        : { getAttribute: (attribute) => attribute === "title" ? "Sep 12, 2026" : null };
    }
    querySelectorAll() { return [from, kayla]; }
    removeAttribute(attribute) { this.attributes.delete(attribute); }
    setAttribute(attribute, value) { this.attributes.set(attribute, value); }
  }
  const latestMessage = new GmailMessageElement();
  vm.runInNewContext(bridgeSource, {
    Element: GmailMessageElement,
    URL,
    chrome: { runtime: { sendMessage: async (message) => messages.push(message) } },
    console: {
      info: (name) => diagnostics.push(name),
      warn: (name) => diagnostics.push(name),
    },
    crypto: { randomUUID: () => "correlation-1" },
    decodeURIComponent,
    document: {
      addEventListener: (type, listener) => { listeners.set(type, listener); },
      querySelectorAll: () => [latestMessage],
    },
    window: {
      addEventListener() {},
      location: {
        hash: "#all/FMfcgzExample",
        hostname: "mail.google.com",
        href: "https://mail.google.com/mail/u/2/#all/FMfcgzExample",
        pathname: "/mail/u/2/",
      },
    },
  });

  listeners.get("pointerdown")({ button: 0, target: latestMessage });
  assert.equal(latestMessage.getAttribute("draggable"), "true");
  listeners.get("dragstart")({ dataTransfer: transfer });
  await Promise.resolve();
  assert.equal(
    transfer.getData("text/uri-list"),
    "https://mail.google.com/mail/u/2/#all/FMfcgzExample",
  );
  assert.equal(
    transfer.getData("text/plain"),
    "https://mail.google.com/mail/u/2/#all/FMfcgzExample",
  );
  assert.equal(transfer.effectAllowed, "copy");
  assert.deepEqual(
    JSON.parse(transfer.getData("application/x-carnival-gmail")),
    {
      correlationId: "correlation-1",
      threadContext: {
        from: { email: "me@example.com", name: "Me" },
        lastMessageAt: "Sep 12, 2026",
        to: [{ email: "kayla@example.com", name: "Kayla" }],
      },
      url: "https://mail.google.com/mail/u/2/#all/FMfcgzExample",
    },
  );
  const dragMessage = messages.find((message) => message.type === "storePendingGmailDrag");
  assert.equal(dragMessage.type, "storePendingGmailDrag");
  assert.equal(dragMessage.attachment.threadRef, "FMfcgzExample");
  transfer.dropEffect = "copy";
  listeners.get("dragend")({ dataTransfer: transfer });
  assert.deepEqual(diagnostics, [
    "GMAIL_CONTENT_SCRIPT_LOADED",
    "GMAIL_POINTER_DOWN",
    "GMAIL_DRAG_TARGET_RESOLVED",
    "GMAIL_DRAG_CONTEXT_RESOLVED",
    "GMAIL_NATIVE_DRAGSTART",
    "GMAIL_DRAG_PAYLOAD_SET",
    "GMAIL_DRAG_STARTED",
    "GMAIL_DRAG_PAYLOAD",
    "GMAIL_SOURCE_DRAGEND",
  ]);
  assert.equal(latestMessage.getAttribute("draggable"), null);
});

test("PlayHouse resolves a stripped cross-window payload from short-lived extension memory", async () => {
  const listeners = new Map();
  let dispatched;
  const diagnostics = [];
  const runtimeMessages = [];
  class TestElement {
    closest() { return { getAttribute: () => "play-1" }; }
  }
  class TestCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init.detail; }
  }
  vm.runInNewContext(bridgeSource, {
    CustomEvent: TestCustomEvent,
    Element: TestElement,
    URL,
    chrome: {
      runtime: {
        sendMessage: async (message) => {
          runtimeMessages.push(message);
          return message.type === "getPendingGmailDrag" ? ({
              actionId: "correlation-pending",
              attachment: {
                accountIndex: 0,
                canonicalUrl: "https://mail.google.com/mail/u/0/#all/FMpending",
                threadRef: "FMpending",
                threadContext: {
                  from: { email: "kayla@example.com", name: "Kayla" },
                  lastMessageAt: "Sep 12, 2026",
                  to: [{ email: "me@example.com", name: "Me" }],
                },
              },
              correlationId: "correlation-pending",
            }) : ({ ok: true });
        },
      },
    },
    console: {
      info: (name) => diagnostics.push(name),
      warn: (name) => diagnostics.push(name),
    },
    decodeURIComponent,
    document: { addEventListener: (type, listener) => { listeners.set(type, listener); } },
    window: {
      addEventListener() {},
      dispatchEvent: (event) => { dispatched = event; },
      location: { hostname: "carnival-playhouse.vercel.app" },
    },
  });

  let prevented = false;
  let dragoverPrevented = false;
  let propagationStopped = false;
  const target = new TestElement();
  const dragoverTransfer = dataTransfer({
    "text/plain": "https://mail.google.com/mail/u/0/#all/FMpending",
    "text/uri-list": "https://mail.google.com/mail/u/0/#all/FMpending",
  });
  listeners.get("dragenter")({ dataTransfer: dragoverTransfer, target });
  listeners.get("dragover")({
    dataTransfer: dragoverTransfer,
    preventDefault: () => { dragoverPrevented = true; },
    target,
  });
  listeners.get("dragover")({
    dataTransfer: dragoverTransfer,
    preventDefault: () => { dragoverPrevented = true; },
    target,
  });
  listeners.get("drop")({
    dataTransfer: dataTransfer(),
    preventDefault: () => { prevented = true; },
    stopImmediatePropagation: () => { propagationStopped = true; },
    target,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dragoverPrevented, true);
  assert.equal(dragoverTransfer.dropEffect, "copy");
  await Promise.resolve();
  assert.equal(prevented, true);
  assert.equal(propagationStopped, true);
  assert.equal(dispatched.type, "carnival:gmail-drop-fallback");
  assert.deepEqual(JSON.parse(dispatched.detail), {
    correlationId: "correlation-pending",
    playId: "play-1",
    threadContext: {
      from: { email: "kayla@example.com", name: "Kayla" },
      lastMessageAt: "Sep 12, 2026",
      to: [{ email: "me@example.com", name: "Me" }],
    },
    url: "https://mail.google.com/mail/u/0/#all/FMpending",
  });
  assert.deepEqual(diagnostics, [
    "GMAIL_DRAG_ENTER_PH",
    "GMAIL_DRAG_OVER_PLAY",
    "GMAIL_NATIVE_DROP_CAPTURED",
    "GMAIL_DRAG_PAYLOAD_MISSING",
    "GMAIL_PENDING_DRAG_USED",
  ]);
  assert.equal(runtimeMessages.filter(({ type }) => type === "getPendingGmailDrag").length, 1);
  assert.equal(runtimeMessages.filter(({ type }) => type === "consumePendingGmailDrag").length, 1);
});

test("PlayHouse bridge leaves internal row drags untouched", () => {
  const listeners = new Map();
  class TestElement {
    closest() { return { getAttribute: () => "play-1" }; }
  }
  vm.runInNewContext(bridgeSource, {
    CustomEvent: class {},
    Element: TestElement,
    URL,
    chrome: { runtime: { sendMessage: async () => ({ ok: true }) } },
    console: { info() {}, warn() {} },
    decodeURIComponent,
    document: { addEventListener: (type, listener) => { listeners.set(type, listener); } },
    window: {
      addEventListener() {},
      dispatchEvent() {},
      location: { hostname: "carnival-playhouse.vercel.app" },
    },
  });
  let prevented = false;
  listeners.get("drop")({
    dataTransfer: dataTransfer({ "text/plain": "play-1,play-2" }),
    preventDefault: () => { prevented = true; },
    stopImmediatePropagation() {},
    target: new TestElement(),
  });
  assert.equal(prevented, false);
});

test("Gmail inbox drag resolves the exact row instead of requiring a thread URL", async () => {
  const listeners = new Map();
  const messages = [];
  const diagnostics = [];
  const sender = {
    getAttribute: (attribute) => attribute === "email"
      ? "sender@example.test"
      : attribute === "name" ? "Sender" : null,
    textContent: "Sender",
  };
  class InboxRow {
    constructor(threadRef) {
      this.attributes = new Map([["data-legacy-thread-id", threadRef]]);
    }
    closest() { return this; }
    getAttribute(attribute) { return this.attributes.get(attribute) ?? null; }
    querySelector(selector) {
      return selector.includes("tooltip")
        ? { getAttribute: (attribute) => attribute === "title" ? "Sep 12, 2026" : null }
        : null;
    }
    querySelectorAll(selector) { return selector === "a[href]" ? [] : [sender]; }
    removeAttribute(attribute) { this.attributes.delete(attribute); }
    setAttribute(attribute, value) { this.attributes.set(attribute, value); }
  }
  const row = new InboxRow("thread-from-row");
  vm.runInNewContext(bridgeSource, {
    Element: InboxRow,
    URL,
    chrome: { runtime: { sendMessage: async (message) => messages.push(message) } },
    console: {
      info: (event, details) => diagnostics.push({ details, event }),
      warn: (event, details) => diagnostics.push({ details, event }),
    },
    crypto: { randomUUID: () => "inbox-action" },
    decodeURIComponent,
    document: {
      addEventListener: (type, listener) => { listeners.set(type, listener); },
      querySelector: () => ({
        getAttribute: () => "Google Account: Self (self@example.test)",
      }),
      querySelectorAll: () => [],
    },
    window: {
      addEventListener() {},
      location: {
        hash: "#inbox",
        hostname: "mail.google.com",
        href: "https://mail.google.com/mail/u/0/#inbox",
        pathname: "/mail/u/0/",
      },
    },
  });
  const transfer = dataTransfer();
  listeners.get("pointerdown")({ button: 0, clientX: 10, clientY: 10, target: row });
  listeners.get("dragstart")({ dataTransfer: transfer, target: row });
  await Promise.resolve();
  const stored = messages.find(({ type }) => type === "storePendingGmailDrag");
  assert.equal(stored.attachment.threadRef, "thread-from-row");
  assert.equal(stored.attachment.canonicalUrl,
    "https://mail.google.com/mail/u/0/#all/thread-from-row");
  assert.deepEqual(JSON.parse(JSON.stringify(stored.attachment.threadContext)), {
    from: { email: "sender@example.test", name: "Sender" },
    lastMessageAt: "Sep 12, 2026",
    to: [{ email: "self@example.test", name: null }],
  });
  const targetDiagnostic = diagnostics.find(({ event }) => event === "GMAIL_DRAG_TARGET_RESOLVED");
  assert.equal(targetDiagnostic.details.source, "gmail-thread-row");
});

test("Gmail inbox without a thread row rejects cleanly", () => {
  const listeners = new Map();
  const diagnostics = [];
  class NonThreadElement {
    closest() { return null; }
  }
  vm.runInNewContext(bridgeSource, {
    Element: NonThreadElement,
    URL,
    chrome: { runtime: { sendMessage: async () => ({ ok: true }) } },
    console: {
      info: (event, details) => diagnostics.push({ details, event }),
      warn: (event, details) => diagnostics.push({ details, event }),
    },
    crypto: { randomUUID: () => "unused" },
    decodeURIComponent,
    document: {
      addEventListener: (type, listener) => { listeners.set(type, listener); },
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    window: {
      addEventListener() {},
      location: {
        hash: "#inbox",
        hostname: "mail.google.com",
        href: "https://mail.google.com/mail/u/0/#inbox",
        pathname: "/mail/u/0/",
      },
    },
  });
  listeners.get("pointerdown")({
    button: 0,
    clientX: 1,
    clientY: 1,
    target: new NonThreadElement(),
  });
  assert.equal(
    diagnostics.find(({ event }) => event === "GMAIL_DRAG_CONTEXT_FAILED").details.reason,
    "no-thread-under-pointer",
  );
});

test("invalidated extension context is reported without throwing", () => {
  const diagnostics = [];
  assert.doesNotThrow(() => vm.runInNewContext(bridgeSource, {
    Element: class {},
    URL,
    chrome: {
      runtime: {
        get onMessage() { throw new Error("Extension context invalidated."); },
        sendMessage() { throw new Error("Extension context invalidated."); },
      },
    },
    console: {
      info() {},
      warn: (event) => diagnostics.push(event),
    },
    decodeURIComponent,
    document: { addEventListener() {}, querySelectorAll: () => [] },
    window: {
      addEventListener() {},
      location: {
        hash: "#inbox",
        hostname: "mail.google.com",
        pathname: "/mail/u/0/",
      },
    },
  }));
  assert.ok(diagnostics.includes("GMAIL_EXTENSION_CONTEXT_INVALIDATED"));
});
