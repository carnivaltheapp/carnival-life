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

test("Gmail dragstart adds canonical standard and Carnival payloads", async () => {
  let dragstart;
  const messages = [];
  const transfer = dataTransfer();
  const participant = (email, name) => ({
    getAttribute: (attribute) => attribute === "email" ? email : attribute === "name" ? name : null,
    textContent: name,
  });
  const from = participant("me@example.com", "Me");
  const kayla = participant("kayla@example.com", "Kayla");
  const latestMessage = {
    querySelector: () => from,
    querySelectorAll: () => [from, kayla],
  };
  vm.runInNewContext(bridgeSource, {
    URL,
    chrome: { runtime: { sendMessage: async (message) => messages.push(message) } },
    console: { info() {} },
    crypto: { randomUUID: () => "correlation-1" },
    decodeURIComponent,
    document: {
      addEventListener: (type, listener) => { if (type === "dragstart") dragstart = listener; },
      querySelectorAll: () => [latestMessage],
    },
    window: {
      location: {
        hostname: "mail.google.com",
        href: "https://mail.google.com/mail/u/2/#all/FMfcgzQhWLFntPRFdFXdtPtlPVcJCTFC",
      },
    },
  });

  dragstart({ dataTransfer: transfer });
  await Promise.resolve();
  assert.equal(
    transfer.getData("text/uri-list"),
    "https://mail.google.com/mail/u/2/#all/FMfcgzQhWLFntPRFdFXdtPtlPVcJCTFC",
  );
  assert.deepEqual(
    JSON.parse(transfer.getData("application/x-carnival-gmail")),
    {
      correlationId: "correlation-1",
      gmailParticipants: {
        from: { email: "me@example.com", name: "Me" },
        to: [{ email: "kayla@example.com", name: "Kayla" }],
      },
      url: "https://mail.google.com/mail/u/2/#all/FMfcgzQhWLFntPRFdFXdtPtlPVcJCTFC",
    },
  );
  assert.equal(messages[0].type, "gmailDragStarted");
  assert.equal(messages[0].attachment.threadRef, "FMfcgzQhWLFntPRFdFXdtPtlPVcJCTFC");
  assert.equal(messages[0].attachment.gmailParticipants.to[0].email, "kayla@example.com");
});

test("PlayHouse resolves a stripped cross-window payload from short-lived extension memory", async () => {
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
    chrome: {
      runtime: {
        sendMessage: async () => ({
          attachment: {
            accountIndex: 0,
            canonicalUrl: "https://mail.google.com/mail/u/0/#all/FMpending",
            gmailParticipants: {
              from: { email: "kayla@example.com", name: "Kayla" },
              to: [{ email: "me@example.com", name: "Me" }],
            },
            threadRef: "FMpending",
          },
          correlationId: "correlation-pending",
        }),
      },
    },
    console: { info() {} },
    decodeURIComponent,
    document: { addEventListener: (type, listener) => { if (type === "drop") drop = listener; } },
    window: {
      dispatchEvent: (event) => { dispatched = event; },
      location: { hostname: "carnival-playhouse.vercel.app" },
    },
  });

  drop({ dataTransfer: dataTransfer({ "text/plain": "Gmail" }), target: new TestElement() });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(dispatched.type, "carnival:gmail-drop-fallback");
  assert.deepEqual(JSON.parse(dispatched.detail), {
    correlationId: "correlation-pending",
    gmailParticipants: {
      from: { email: "kayla@example.com", name: "Kayla" },
      to: [{ email: "me@example.com", name: "Me" }],
    },
    playId: "play-1",
    url: "https://mail.google.com/mail/u/0/#all/FMpending",
  });
});
