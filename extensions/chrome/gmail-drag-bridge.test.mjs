import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridgeSource = await readFile(new URL("./gmail-drag-bridge.js", import.meta.url), "utf8");

function dataTransfer(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getData: (type) => values.get(type) ?? "" };
}

function playhouseContext(sendMessage, options = {}) {
  let drop;
  const dispatched = [];
  const windowListeners = new Map();
  const destination = {
    closest: (selector) => selector === "[data-gmail-bullseye-active='true']"
      ? destination
      : null,
    getAttribute: () => JSON.stringify(options.placement),
  };
  class TestElement {
    closest(selector) {
      if (selector === "[data-play-row-id]") {
        return options.placement ? null : { getAttribute: () => "play-1" };
      }
      if (selector === "[data-gmail-new-play-placement]") {
        return options.placement ? destination : null;
      }
      return null;
    }
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
      addEventListener: (type, listener) => windowListeners.set(type, listener),
      dispatchEvent: (event) => { dispatched.push(event); },
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
    dispatched: () => dispatched.at(-1),
    windowEvent: (type, detail) => windowListeners.get(type)?.(new TestCustomEvent(type, { detail })),
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
    document: {
      querySelector: () => ({ textContent: "Quarterly planning" }),
      querySelectorAll: () => [hidden, latest],
    },
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
    gmailSubject: "Quarterly planning",
    threadRef: "FMexact",
  });
  assert.deepEqual(registeredWindowEvents, []);
});

test("Gmail content script stars only the exact open thread without navigation", () => {
  let metadataListener;
  let clicked = 0;
  const star = {
    click: () => { clicked += 1; },
    getAttribute: (attribute) => attribute === "aria-label" ? "Not starred" : null,
  };
  const latest = {
    getAttribute: () => null,
    getClientRects: () => [{}],
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "[aria-label], [data-tooltip], [title]"
      ? [star]
      : [],
  };
  const location = {
    hostname: "mail.google.com",
    href: "https://mail.google.com/mail/u/2/#all/FMexact",
  };
  vm.runInNewContext(bridgeSource, {
    URL,
    chrome: {
      runtime: { onMessage: { addListener: (listener) => { metadataListener = listener; } } },
    },
    decodeURIComponent,
    document: { querySelectorAll: () => [latest] },
    window: { location },
  });

  let response;
  metadataListener(
    { threadRef: "FMexact", type: "starVisibleGmailThread" },
    null,
    (value) => { response = value; },
  );
  assert.equal(response.ok, true);
  assert.equal(clicked, 1);
  assert.equal(location.href, "https://mail.google.com/mail/u/2/#all/FMexact");

  metadataListener(
    { threadRef: "FMwrong", type: "starVisibleGmailThread" },
    null,
    (value) => { response = value; },
  );
  assert.equal(response.ok, false);
  assert.equal(response.reason, "thread_mismatch");
  assert.equal(clicked, 1);
});

test("omnibox Gmail URL drop requests exact-tab metadata and attaches participants", async () => {
  let request;
  const gmailParticipants = {
    from: { email: "kayla@example.com", name: "Kayla" },
    to: [{ email: "me@example.com", name: "Me" }],
  };
  const context = playhouseContext(async (message) => {
    request = message;
    return { gmailParticipants, gmailSubject: "Quarterly planning", returnedThreadRef: "FMexact" };
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

test("omnibox Gmail URL dropped on an active Bullseye destination carries subject and placement", async () => {
  const placement = { basketId: "11111111-1111-4111-8111-111111111111", kind: "basket" };
  const context = playhouseContext(async () => ({
    gmailParticipants: null,
    gmailSubject: "Quarterly planning",
    returnedThreadRef: "FMexact",
  }), { placement });

  context.drop(dataTransfer({
    "text/uri-list": "https://mail.google.com/mail/u/2/#inbox/FMexact",
  }));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(context.dispatched().type, "carnival:gmail-bullseye-drop");
  assert.deepEqual(JSON.parse(context.dispatched().detail), {
    correlationId: "correlation-1",
    placement,
    subject: "Quarterly planning",
    url: "https://mail.google.com/mail/u/2/#all/FMexact",
  });
});

test("PlayHouse requests exact-thread starring and reports failure without navigation", async () => {
  let request;
  const context = playhouseContext(async (message) => {
    request = message;
    return { ok: false, reason: "star_control_not_found" };
  });
  context.windowEvent("carnival:gmail-star-thread", JSON.stringify({
    accountIndex: 2,
    correlationId: "correlation-1",
    threadRef: "FMexact",
  }));
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    accountIndex: 2,
    correlationId: "correlation-1",
    threadRef: "FMexact",
    type: "starGmailThread",
  });
  assert.equal(context.dispatched().type, "carnival:gmail-star-result");
  assert.deepEqual(JSON.parse(context.dispatched().detail), {
    correlationId: "correlation-1",
    ok: false,
    reason: "star_control_not_found",
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
