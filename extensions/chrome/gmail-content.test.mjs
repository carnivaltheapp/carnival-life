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

test("open Gmail thread arms and stores after movement without native dragstart", async () => {
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
  listeners.get("pointerdown")({
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 1,
    target,
  });
  listeners.get("pointermove")({ clientX: 17, clientY: 10, pointerId: 1, target });
  await Promise.resolve();
  const store = messages.find(({ type }) => type === "storePendingGmailDrag");
  assert.equal(store.pending.threadRef, "open-thread");
  assert.equal(store.pending.gmailAccountIndex, 0);
  assert.equal(typeof store.pending.armedAt, "number");
  assert.equal(diagnostics.find(({ event }) => event === "GMAIL_DRAG_TARGET_RESOLVED").details.source,
    "open-thread-url");
  assert.ok(diagnostics.some(({ event }) => event === "GMAIL_DRAG_ARMED"));
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
  listeners.get("pointerdown")({
    button: 0,
    clientX: 0,
    clientY: 0,
    pointerId: 2,
    target,
  });
  listeners.get("pointermove")({ clientX: 6, clientY: 0, pointerId: 2, target });
  await Promise.resolve();
  const store = messages.find(({ type }) => type === "storePendingGmailDrag");
  assert.equal(store.pending.threadRef, "row-thread");
  assert.equal(store.pending.threadContext.from.email, "sender@example.test");
  assert.equal(diagnostics.find(({ event }) => event === "GMAIL_DRAG_TARGET_RESOLVED").details.source,
    "gmail-thread-row");
});

test("normal Gmail click cancels without storing a pending drag", () => {
  const messages = [];
  const diagnostics = [];
  class Message {
    constructor() { this.attributes = new Map(); this.messages = []; }
    closest(selector) { return selector === "[data-message-id]" ? this : null; }
    getAttribute(attribute) { return this.attributes.get(attribute) ?? null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    removeAttribute(attribute) { this.attributes.delete(attribute); }
    setAttribute(attribute, value) { this.attributes.set(attribute, value); }
  }
  const target = new Message();
  const { listeners } = gmailEnvironment({
    diagnostics,
    hash: "#inbox/click-thread",
    href: "https://mail.google.com/mail/u/0/#inbox/click-thread",
    messages,
    target,
  });
  listeners.get("pointerdown")({
    button: 0,
    clientX: 2,
    clientY: 2,
    pointerId: 3,
    target,
  });
  listeners.get("pointerup")({ pointerId: 3, target });
  assert.equal(messages.some(({ type }) => type === "storePendingGmailDrag"), false);
  assert.equal(
    diagnostics.find(({ event }) => event === "GMAIL_DRAG_CANDIDATE_CANCELLED").details.reason,
    "pointerup-before-threshold",
  );
});

test("native dragstart before or after threshold stores one locked action", async () => {
  for (const nativeFirst of [true, false]) {
    const messages = [];
    class Message {
      constructor() { this.attributes = new Map(); this.messages = []; }
      closest(selector) { return selector === "[data-message-id]" ? this : null; }
      getAttribute(attribute) { return this.attributes.get(attribute) ?? null; }
      querySelector() { return null; }
      querySelectorAll() { return []; }
      removeAttribute(attribute) { this.attributes.delete(attribute); }
      setAttribute(attribute, value) { this.attributes.set(attribute, value); }
    }
    const target = new Message();
    const { listeners } = gmailEnvironment({
      hash: "#all/native-thread",
      href: "https://mail.google.com/mail/u/0/#all/native-thread",
      messages,
      target,
    });
    listeners.get("pointerdown")({
      button: 0,
      clientX: 0,
      clientY: 0,
      pointerId: 4,
      target,
    });
    const native = () => listeners.get("dragstart")({ dataTransfer: transfer(), target });
    const move = () => listeners.get("pointermove")({ clientX: 8, clientY: 0, pointerId: 4, target });
    if (nativeFirst) { native(); move(); } else { move(); native(); }
    await Promise.resolve();
    const stores = messages.filter(({ type }) => type === "storePendingGmailDrag");
    assert.equal(stores.length, 1);
    assert.equal(stores[0].pending.actionId.startsWith("action-"), true);
  }
});

test("unrelated pointer events cannot clear or replace a resolved gesture", async () => {
  const messages = [];
  class Message {
    constructor() { this.attributes = new Map(); this.messages = []; }
    closest(selector) { return selector === "[data-message-id]" ? this : null; }
    getAttribute(attribute) { return this.attributes.get(attribute) ?? null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    removeAttribute(attribute) { this.attributes.delete(attribute); }
    setAttribute(attribute, value) { this.attributes.set(attribute, value); }
  }
  const target = new Message();
  const { listeners } = gmailEnvironment({
    hash: "#all/locked-thread",
    href: "https://mail.google.com/mail/u/0/#all/locked-thread",
    messages,
    target,
  });
  listeners.get("pointerdown")({
    button: 0,
    clientX: 0,
    clientY: 0,
    pointerId: 7,
    target,
  });
  listeners.get("pointermove")({ clientX: 20, clientY: 20, pointerId: 8, target: {} });
  listeners.get("pointerup")({ pointerId: 8, target: {} });
  listeners.get("pointermove")({ clientX: 7, clientY: 0, pointerId: 7, target: {} });
  await Promise.resolve();
  const stores = messages.filter(({ type }) => type === "storePendingGmailDrag");
  assert.equal(stores.length, 1);
  assert.equal(stores[0].pending.threadRef, "locked-thread");
});

test("composed-path sender, subject, snippet, and icon targets resolve the same inbox row", async () => {
  for (const part of ["sender", "subject", "snippet", "icon"]) {
    const messages = [];
    class GmailNode {
      constructor(kind) {
        this.kind = kind;
        this.attributes = new Map(kind === "row" ? [["data-legacy-thread-id", "same-row"]] : []);
      }
      closest() { return this.kind === "row" ? this : null; }
      getAttribute(attribute) { return this.attributes.get(attribute) ?? null; }
      matches() { return this.kind === "row"; }
      querySelector() { return null; }
      querySelectorAll() { return []; }
      removeAttribute(attribute) { this.attributes.delete(attribute); }
      setAttribute(attribute, value) { this.attributes.set(attribute, value); }
    }
    const row = new GmailNode("row");
    const child = new GmailNode(part);
    const { listeners } = gmailEnvironment({
      hash: "#inbox",
      href: "https://mail.google.com/mail/u/0/#inbox",
      messages,
      target: child,
    });
    listeners.get("pointerdown")({
      button: 0,
      clientX: 0,
      clientY: 0,
      composedPath: () => [child, row],
      pointerId: 5,
      target: child,
    });
    row.attributes.clear();
    listeners.get("pointermove")({ clientX: 7, clientY: 0, pointerId: 5, target: child });
    await Promise.resolve();
    const stores = messages.filter(({ type }) => type === "storePendingGmailDrag");
    assert.equal(stores.length, 1, part);
    assert.equal(stores[0].pending.threadRef, "same-row", part);
  }
});

test("twenty mixed gestures arm fresh snapshots with or without native dragstart", async () => {
  for (let index = 0; index < 20; index += 1) {
    const messages = [];
    const inboxRow = index % 2 === 1;
    class GmailTarget {
      constructor() {
        this.attributes = new Map(inboxRow
          ? [["data-legacy-thread-id", `thread-${index}`]]
          : []);
        this.messages = [];
      }
      closest(selector) {
        if (inboxRow) return this;
        return selector === "[data-message-id]" ? this : null;
      }
      getAttribute(attribute) { return this.attributes.get(attribute) ?? null; }
      matches() { return inboxRow; }
      querySelector() { return null; }
      querySelectorAll() { return []; }
      removeAttribute(attribute) { this.attributes.delete(attribute); }
      setAttribute(attribute, value) { this.attributes.set(attribute, value); }
    }
    const target = new GmailTarget();
    const hash = inboxRow ? "#inbox" : `#all/thread-${index}`;
    const { listeners } = gmailEnvironment({
      hash,
      href: `https://mail.google.com/mail/u/0/${hash}`,
      messages,
      target,
    });
    listeners.get("pointerdown")({
      button: 0,
      clientX: 0,
      clientY: 0,
      pointerId: index,
      target,
    });
    if (index % 3 === 0) {
      listeners.get("dragstart")({ dataTransfer: transfer(), target });
    } else {
      listeners.get("pointermove")({ clientX: 8, clientY: 0, pointerId: index, target });
    }
    await Promise.resolve();
    const stores = messages.filter(({ type }) => type === "storePendingGmailDrag");
    assert.equal(stores.length, 1, `gesture ${index}`);
    assert.equal(stores[0].pending.threadRef, `thread-${index}`);
  }
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
