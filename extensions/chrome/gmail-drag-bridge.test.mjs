import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridgeSource = await readFile(new URL("./gmail-drag-bridge.js", import.meta.url), "utf8");

function dataTransfer(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getData: (type) => values.get(type) ?? "" };
}

function playhouseContext(sendMessage) {
  let drop;
  let dispatched;
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
    chrome: { runtime: { sendMessage } },
    console: { info() {} },
    crypto: { randomUUID: () => "correlation-1" },
    decodeURIComponent,
    document: { addEventListener: (type, listener) => { if (type === "drop") drop = listener; } },
    window: {
      dispatchEvent: (event) => { dispatched = event; },
      location: { hostname: "carnival-playhouse.vercel.app" },
    },
  });
  return {
    drop: (transfer) => drop({
      dataTransfer: transfer,
      preventDefault() {},
      stopImmediatePropagation() {},
      target: new TestElement(),
    }),
    dispatched: () => dispatched,
  };
}

test("manifest injects the bridge into Gmail and PlayHouse", async () => {
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

test("Gmail content script returns latest visible participants without page-drag handlers", () => {
  let metadataListener;
  const registeredWindowEvents = [];
  const participant = (email, name) => ({
    getAttribute: (attribute) => attribute === "email" ? email : attribute === "name" ? name : null,
    textContent: name,
  });
  const hidden = {
    getAttribute: (attribute) => attribute === "aria-hidden" ? "true" : null,
    getClientRects: () => [],
  };
  const from = participant("me@example.com", "Me");
  const kayla = participant("kayla@example.com", "Kayla");
  const latest = {
    getAttribute: () => null,
    getClientRects: () => [{}],
    querySelector: () => from,
    querySelectorAll: () => [from, kayla],
  };
  vm.runInNewContext(bridgeSource, {
    URL,
    chrome: {
      runtime: { onMessage: { addListener: (listener) => { metadataListener = listener; } } },
    },
    decodeURIComponent,
    document: { querySelectorAll: () => [hidden, latest] },
    window: {
      addEventListener: (type) => registeredWindowEvents.push(type),
      location: {
        hostname: "mail.google.com",
        href: "https://mail.google.com/mail/u/2/#all/FMexact",
      },
    },
  });

  let response;
  metadataListener(
    { type: "getVisibleGmailParticipants" },
    null,
    (value) => { response = value; },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(response)), {
    gmailParticipants: {
      from: { email: "me@example.com", name: "Me" },
      to: [{ email: "kayla@example.com", name: "Kayla" }],
    },
    threadRef: "FMexact",
  });
  assert.deepEqual(registeredWindowEvents, []);
});

test("omnibox Gmail URL drop requests exact-tab metadata and attaches participants", async () => {
  let request;
  const gmailParticipants = {
    from: { email: "kayla@example.com", name: "Kayla" },
    to: [{ email: "me@example.com", name: "Me" }],
  };
  const context = playhouseContext(async (message) => {
    request = message;
    return { gmailParticipants, returnedThreadRef: "FMexact" };
  });

  context.drop(dataTransfer({
    "text/uri-list": "https://mail.google.com/mail/u/2/#inbox/FMexact",
  }));
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    accountIndex: 2,
    canonicalUrl: "https://mail.google.com/mail/u/2/#all/FMexact",
    correlationId: "correlation-1",
    threadRef: "FMexact",
    type: "getGmailThreadParticipants",
  });
  assert.deepEqual(JSON.parse(context.dispatched().detail), {
    correlationId: "correlation-1",
    gmailParticipants,
    playId: "play-1",
    url: "https://mail.google.com/mail/u/2/#all/FMexact",
  });
});

test("metadata failure preserves URL-only Gmail attachment", async () => {
  const context = playhouseContext(async () => {
    throw new Error("matching Gmail tab unavailable");
  });

  context.drop(dataTransfer({
    "text/plain": "https://mail.google.com/mail/u/0/#all/FMonly",
  }));
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(JSON.parse(context.dispatched().detail), {
    correlationId: "correlation-1",
    playId: "play-1",
    url: "https://mail.google.com/mail/u/0/#all/FMonly",
  });
});
