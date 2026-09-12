import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./gmail-content.js", import.meta.url), "utf8");

function transfer() {
  const values = new Map();
  return {
    get types() { return [...values.keys()]; },
    getData: (type) => values.get(type) ?? "",
    setData: (type, value) => values.set(type, value),
  };
}

function gmailEnvironment({ hash, href, target, messages = [], diagnostics = [] }) {
  const listeners = new Map();
  const runtimeListeners = [];
  const context = {
    Element: target.constructor,
    URL,
    chrome: {
      runtime: {
        id: "extension-id",
        onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
        sendMessage: async (message) => { messages.push(message); return { ok: true }; },
      },
    },
    console: {
      info: (event, details) => diagnostics.push({ details, event }),
      warn: (event, details) => diagnostics.push({ details, event }),
    },
    crypto: { randomUUID: () => `action-${messages.length}` },
    decodeURIComponent,
    document: {
      addEventListener: (type, listener) => listeners.set(type, listener),
      querySelector: () => ({
        getAttribute: () => "Google Account: Self (self@example.test)",
      }),
      querySelectorAll: () => target.messages ?? [],
    },
    window: {
      addEventListener() {},
      location: {
        hash,
        href,
        hostname: "mail.google.com",
        pathname: "/mail/u/0/",
      },
    },
  };
  vm.runInNewContext(source, context);
  return { listeners, runtimeListeners };
}

test("manifest uses separate isolated Gmail and PlayHouse content scripts", async () => {
  const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"));
  const playhouseSource = await readFile(
    new URL("../../apps/playhouse/components/playhouse-shell.tsx", import.meta.url),
    "utf8",
  );
  const gmail = manifest.content_scripts.find(({ matches }) =>
    matches.includes("https://mail.google.com/*"));
  const playhouse = manifest.content_scripts.find(({ matches }) =>
    matches.includes("https://carnival-playhouse.vercel.app/*"));
  assert.deepEqual(gmail.js, ["gmail-content.js"]);
  assert.ok(playhouse.js.includes("gmail-playhouse-content.js"));
  assert.notEqual(gmail.world, "MAIN");
  assert.notEqual(playhouse.world, "MAIN");
  assert.equal(playhouseSource.includes("chrome.runtime"), false);
});

test("open Gmail thread resolves from its URL and stores through isolated runtime", async () => {
  const messages = [];
  const diagnostics = [];
  const participant = (email, name) => ({
    getAttribute: (attribute) => attribute === "email" ? email : attribute === "name" ? name : null,
    textContent: name,
  });
  const from = participant("self@example.test", "Self");
  const other = participant("other@example.test", "Other");
  class Message {
    constructor() { this.attributes = new Map(); this.messages = [this]; }
    closest(selector) { return selector === "[data-message-id]" ? this : null; }
    getAttribute(attribute) { return this.attributes.get(attribute) ?? null; }
    querySelector(selector) {
      return selector.startsWith(".gD")
        ? from
        : { getAttribute: (attribute) => attribute === "title" ? "Sep 12, 2026" : null };
    }
    querySelectorAll() { return [from, other]; }
    removeAttribute(attribute) { this.attributes.delete(attribute); }
    setAttribute(attribute, value) { this.attributes.set(attribute, value); }
  }
  const target = new Message();
  const { listeners } = gmailEnvironment({
    diagnostics,
    hash: "#inbox/open-thread",
    href: "https://mail.google.com/mail/u/0/#inbox/open-thread",
    messages,
    target,
  });
  listeners.get("pointerdown")({ button: 0, target });
  const dataTransfer = transfer();
  listeners.get("dragstart")({ dataTransfer, target });
  await Promise.resolve();
  const store = messages.find(({ type }) => type === "storePendingGmailDrag");
  assert.equal(store.pending.threadRef, "open-thread");
  assert.equal(store.pending.gmailAccountIndex, 0);
  assert.equal(dataTransfer.getData("text/uri-list"), store.pending.canonicalUrl);
  assert.equal(diagnostics.find(({ event }) => event === "GMAIL_DRAG_TARGET_RESOLVED").details.source,
    "open-thread-url");
});

test("Gmail inbox drag resolves the exact row captured at pointerdown", async () => {
  const messages = [];
  const diagnostics = [];
  const sender = {
    getAttribute: (attribute) => attribute === "email"
      ? "sender@example.test"
      : attribute === "name" ? "Sender" : null,
    textContent: "Sender",
  };
  class InboxRow {
    constructor() { this.attributes = new Map([["data-legacy-thread-id", "row-thread"]]); }
    closest() { return this; }
    getAttribute(attribute) { return this.attributes.get(attribute) ?? null; }
    querySelector(selector) {
      return selector.includes("tooltip")
        ? { getAttribute: () => "Sep 12, 2026" }
        : null;
    }
    querySelectorAll(selector) { return selector === "a[href]" ? [] : [sender]; }
    removeAttribute(attribute) { this.attributes.delete(attribute); }
    setAttribute(attribute, value) { this.attributes.set(attribute, value); }
  }
  const target = new InboxRow();
  const { listeners } = gmailEnvironment({
    diagnostics,
    hash: "#inbox",
    href: "https://mail.google.com/mail/u/0/#inbox",
    messages,
    target,
  });
  listeners.get("pointerdown")({ button: 0, target });
  listeners.get("dragstart")({ dataTransfer: transfer(), target });
  await Promise.resolve();
  const store = messages.find(({ type }) => type === "storePendingGmailDrag");
  assert.equal(store.pending.threadRef, "row-thread");
  assert.equal(store.pending.threadContext.from.email, "sender@example.test");
  assert.equal(diagnostics.find(({ event }) => event === "GMAIL_DRAG_TARGET_RESOLVED").details.source,
    "gmail-thread-row");
});

test("stale Gmail content script reports invalidation once and stops messaging", () => {
  const diagnostics = [];
  class ElementStub {}
  assert.doesNotThrow(() => vm.runInNewContext(source, {
    Element: ElementStub,
    URL,
    chrome: { runtime: { get id() { throw new Error("Extension context invalidated."); } } },
    console: { info() {}, warn: (event) => diagnostics.push(event) },
    decodeURIComponent,
    document: { addEventListener() {}, querySelectorAll: () => [] },
    window: {
      addEventListener() {},
      location: { hash: "#inbox", href: "https://mail.google.com/mail/u/0/#inbox", pathname: "/mail/u/0/" },
    },
  }));
  assert.deepEqual(diagnostics, ["GMAIL_EXTENSION_CONTEXT_INVALIDATED"]);
});
