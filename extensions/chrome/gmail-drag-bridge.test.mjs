import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridgeSource = await readFile(new URL("./gmail-drag-bridge.js", import.meta.url), "utf8");
const messagingSource = await readFile(new URL("./extension-messaging.js", import.meta.url), "utf8");

function dataTransfer(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    effectAllowed: "none",
    getData: (type) => values.get(type) ?? "",
    setData: (type, value) => values.set(type, value),
    get types() { return Array.from(values.keys()); },
  };
}

function gmailListRowContext(hash = "#inbox", { metadataPresent = true, messagingFails = false } = {}) {
  const listeners = new Map();
  const messages = [];
  class TestElement {}
  const identity = {
    getAttribute: (attribute) => attribute === "data-thread-id"
      ? "#thread-f:123456789"
      : attribute === "data-legacy-thread-id"
        ? "1a0ad6003af12a6b"
        : null,
  };
  const participant = {
    getAttribute: (attribute) => attribute === "email"
      ? "person@example.com"
      : attribute === "name"
        ? "Person"
        : null,
    textContent: "Person",
  };
  const attributes = new Map([["draggable", "false"]]);
  const row = new TestElement();
  row.closest = (selector) => selector === "tr.zA[role='row']" ? row : null;
  row.getAttribute = (attribute) => attributes.get(attribute) ?? null;
  row.querySelector = (selector) => selector === "[data-thread-id][data-legacy-thread-id]"
    ? metadataPresent ? identity : null
    : selector === ".bog"
      ? { textContent: "List subject" }
      : null;
  row.querySelectorAll = () => [participant];
  row.removeAttribute = (attribute) => attributes.delete(attribute);
  row.setAttribute = (attribute, value) => attributes.set(attribute, value);
  const target = new TestElement();
  target.closest = (selector) => ["tr", "tr.zA[role='row']"].includes(selector) ? row : null;
  const checkbox = new TestElement();
  checkbox.closest = (selector) => selector.includes("[role='checkbox']")
    ? checkbox
    : ["tr", "tr.zA[role='row']"].includes(selector)
      ? row
      : null;
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
    Element: TestElement,
    URL,
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage(message, callback) {
          messages.push(message);
          if (messagingFails) throw new Error("diagnostic unavailable");
          callback?.({ ok: true });
          return Promise.resolve({ ok: true });
        },
      },
    },
    console: { info() {}, warn() {} },
    crypto: { randomUUID: () => "list-correlation-1" },
    decodeURIComponent,
    document: {
      addEventListener: (type, listener) => listeners.set(type, listener),
    },
    window: {
      location: {
        hash,
        hostname: "mail.google.com",
        pathname: "/mail/u/2/",
      },
    },
  });
  return {
    checkbox,
    drag(targetElement = target) {
      listeners.get("pointerdown")?.({ button: 0, target: targetElement });
      const transfer = dataTransfer();
      listeners.get("dragstart")?.({ dataTransfer: transfer, target: row });
      return transfer;
    },
    messages,
    pointerDown(targetElement = target) {
      listeners.get("pointerdown")?.({ button: 0, clientX: 10, clientY: 10, target: targetElement });
    },
    pointerMove() { listeners.get("pointermove")?.({ clientX: 20, clientY: 10 }); },
    pointerUp() { listeners.get("pointerup")?.({}); },
    row,
  };
}

function playhouseContext(sendMessage) {
  let drop;
  const dispatched = [];
  const windowListeners = new Map();
  class TestElement {
    closest(selector) {
      if (selector === "[data-play-row-id]") {
        return { getAttribute: () => "play-1" };
      }
      return null;
    }
  }
  class TestCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init.detail; }
  }
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
    CustomEvent: TestCustomEvent,
    Element: TestElement,
    URL,
    chrome: { runtime: { sendMessage } },
    console: { info() {}, warn() {} },
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
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.host_permissions.includes("https://mail.google.com/*"));
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
    getAttribute: (attribute) => attribute === "data-legacy-thread-id" ? "api-thread-123" : null,
    getClientRects: () => [{}],
    querySelector: () => from,
    querySelectorAll: () => [from, kayla],
  };
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
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
    gmailApiThreadId: "api-thread-123",
    gmailApiThreadStrategy: "direct",
    gmailParticipants: {
      from: { email: "me@example.com", name: "Me" },
      to: [{ email: "kayla@example.com", name: "Kayla" }],
    },
    gmailSubject: "Quarterly planning",
    participants: {
      from: { email: "me@example.com", name: "Me" },
      to: [{ email: "kayla@example.com", name: "Kayla" }],
    },
    subject: "Quarterly planning",
    threadRef: "FMexact",
  });
  assert.deepEqual(registeredWindowEvents, []);
});

test("Gmail content script reads the API thread ID from the sibling conversation header", () => {
  let metadataListener;
  const header = {
    getAttribute: (attribute) => attribute === "data-legacy-thread-id"
      ? "api-thread-from-header"
      : null,
  };
  const conversation = {
    querySelector: (selector) => selector === "h2[data-legacy-thread-id]" ? header : null,
  };
  const participant = {
    getAttribute: (attribute) => attribute === "email"
      ? "person@example.com"
      : attribute === "name"
        ? "Person"
        : null,
    textContent: "Person",
  };
  const latest = {
    closest: (selector) => selector === "div[role='main']" ? conversation : null,
    getAttribute: () => null,
    getClientRects: () => [{}],
    querySelector: () => participant,
    querySelectorAll: () => [participant],
  };
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
    URL,
    chrome: {
      runtime: { onMessage: { addListener: (listener) => { metadataListener = listener; } } },
    },
    decodeURIComponent,
    document: {
      querySelector: () => ({ textContent: "Visible subject" }),
      querySelectorAll: () => [latest],
    },
    window: {
      location: {
        hostname: "mail.google.com",
        href: "https://mail.google.com/mail/u/0/#all/FMexact",
      },
    },
  });

  let response;
  metadataListener(
    { type: "getVisibleGmailParticipants" },
    null,
    (value) => { response = value; },
  );

  assert.equal(response.gmailApiThreadId, "api-thread-from-header");
  assert.equal(response.gmailApiThreadStrategy, "conversation_header");
});

test("Inbox, Sent, search, and label rows use the exact list-row metadata path", () => {
  for (const hash of ["#inbox", "#sent", "#search/query", "#label/Work"]) {
    const context = gmailListRowContext(hash);
    const transfer = context.drag();
    const payload = JSON.parse(transfer.getData("application/x-carnival-gmail"));
    assert.deepEqual(payload, {
      correlationId: "list-correlation-1",
      gmailApiThreadId: "1a0ad6003af12a6b",
      gmailApiThreadStrategy: "direct",
      gmailDragSource: "list_row",
      gmailParticipants: {
        from: { email: "person@example.com", name: "Person" },
        to: [],
      },
      subject: "List subject",
      url: "https://mail.google.com/mail/u/2/#all/%23thread-f%3A123456789",
    });
    assert.equal(transfer.getData("text/uri-list"), payload.url);
    assert.equal(transfer.effectAllowed, "copy");
    assert.deepEqual(JSON.parse(JSON.stringify(context.messages.at(-1))), {
      payload,
      type: "storeGmailListRowDrag",
    });
  }
});

test("list-row drag does not arm Gmail checkbox controls", () => {
  const context = gmailListRowContext();
  const transfer = context.drag(context.checkbox);
  assert.equal(transfer.types.length, 0);
  assert.equal(context.row.getAttribute("draggable"), "false");
  assert.deepEqual(JSON.parse(JSON.stringify(context.messages)), [{
    diagnostic: {
      correlationId: "list-correlation-1",
      reason: "row_not_recognized",
      rowRecognized: false,
      stage: "LIST_ROW_POINTERDOWN",
    },
    type: "recordGmailListRowDiagnostic",
  }]);
});

test("list-row diagnostics cover pointerdown, metadata, and native dragstart", () => {
  const context = gmailListRowContext();
  context.drag();
  const diagnostics = context.messages
    .filter((message) => message.type === "recordGmailListRowDiagnostic")
    .map((message) => message.diagnostic);
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostics)), [
    {
      correlationId: "list-correlation-1",
      reason: "completed",
      rowRecognized: true,
      stage: "LIST_ROW_POINTERDOWN",
    },
    {
      apiThreadPresent: true,
      correlationId: "list-correlation-1",
      draggableTargetPresent: true,
      reason: "completed",
      stage: "LIST_ROW_METADATA_RESOLVED",
      success: true,
      webThreadPresent: true,
    },
    {
      correlationId: "list-correlation-1",
      fired: true,
      metadataReady: true,
      reason: "completed",
      stage: "LIST_ROW_DRAGSTART",
    },
  ]);
  const serialized = JSON.stringify(diagnostics);
  for (const prohibited of ["subject", "email", "url", "threadId", "html", "body"]) {
    assert.equal(serialized.includes(prohibited), false);
  }
});

test("list-row diagnostics expose metadata failure and missing native dragstart", () => {
  const missingMetadata = gmailListRowContext("#inbox", { metadataPresent: false });
  missingMetadata.pointerDown();
  assert.deepEqual(JSON.parse(JSON.stringify(missingMetadata.messages.at(-1).diagnostic)), {
    apiThreadPresent: false,
    correlationId: "list-correlation-1",
    draggableTargetPresent: true,
    reason: "metadata_container_missing",
    stage: "LIST_ROW_METADATA_RESOLVED",
    success: false,
    webThreadPresent: false,
  });

  const noDragstart = gmailListRowContext();
  noDragstart.pointerDown();
  noDragstart.pointerMove();
  noDragstart.pointerUp();
  assert.deepEqual(JSON.parse(JSON.stringify(noDragstart.messages.at(-1).diagnostic)), {
    correlationId: "list-correlation-1",
    fired: false,
    metadataReady: true,
    reason: "dragstart_not_fired",
    stage: "LIST_ROW_DRAGSTART",
  });
});

test("diagnostic transport failure cannot block native list-row payload creation", () => {
  const context = gmailListRowContext("#inbox", { messagingFails: true });
  const transfer = context.drag();
  assert.ok(transfer.getData("text/uri-list").startsWith("https://mail.google.com/"));
  assert.ok(transfer.getData("application/x-carnival-gmail"));
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
    querySelectorAll: (selector) => selector === "[aria-label], [data-tooltip], [title], [tooltip]"
      ? [star]
      : [],
  };
  const location = {
    hostname: "mail.google.com",
    href: "https://mail.google.com/mail/u/2/#all/FMexact",
  };
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
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

test("Gmail content script unstars only the exact open thread without navigation", () => {
  let metadataListener;
  let clicked = 0;
  let unrelatedClicked = 0;
  const unstar = {
    click: () => { clicked += 1; },
    getAttribute: (attribute) => attribute === "tooltip" ? "Starred" : null,
  };
  const unrelated = {
    click: () => { unrelatedClicked += 1; },
    getAttribute: (attribute) => attribute === "tooltip" ? "Starred" : null,
  };
  const latest = {
    getAttribute: () => null,
    getClientRects: () => [{}],
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "[aria-label], [data-tooltip], [title], [tooltip]"
      ? [unstar]
      : [],
  };
  const location = {
    hostname: "mail.google.com",
    href: "https://mail.google.com/mail/u/2/#all/FMexact",
  };
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
    URL,
    chrome: {
      runtime: { onMessage: { addListener: (listener) => { metadataListener = listener; } } },
    },
    decodeURIComponent,
    document: { querySelectorAll: () => [unrelated, latest] },
    window: { location },
  });

  let response;
  metadataListener(
    { threadRef: "FMexact", type: "unstarVisibleGmailThread" },
    null,
    (value) => { response = value; },
  );
  assert.equal(response.ok, true);
  assert.equal(clicked, 1);
  assert.equal(unrelatedClicked, 0);
  assert.equal(location.href, "https://mail.google.com/mail/u/2/#all/FMexact");

  metadataListener(
    { threadRef: "FMwrong", type: "unstarVisibleGmailThread" },
    null,
    (value) => { response = value; },
  );
  assert.equal(response.ok, false);
  assert.equal(response.reason, "thread_mismatch");
  assert.equal(clicked, 1);
  assert.equal(unrelatedClicked, 0);
});

test("Gmail content script recognizes the current tooltip unstarred state", () => {
  let metadataListener;
  let clicked = 0;
  const alreadyUnstarred = {
    click: () => { clicked += 1; },
    getAttribute: (attribute) => attribute === "tooltip" ? "Not starred" : null,
  };
  const latest = {
    getAttribute: () => null,
    getClientRects: () => [{}],
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "[aria-label], [data-tooltip], [title], [tooltip]"
      ? [alreadyUnstarred]
      : [],
  };
  vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
    URL,
    chrome: {
      runtime: { onMessage: { addListener: (listener) => { metadataListener = listener; } } },
    },
    decodeURIComponent,
    document: { querySelectorAll: () => [latest] },
    window: {
      location: {
        hostname: "mail.google.com",
        href: "https://mail.google.com/mail/u/0/#all/FMexact",
      },
    },
  });

  let response;
  metadataListener(
    { threadRef: "FMexact", type: "unstarVisibleGmailThread" },
    null,
    (value) => { response = value; },
  );
  assert.equal(response.ok, true);
  assert.equal(response.alreadyUnstarred, true);
  assert.equal(clicked, 0);
});

test("Gmail star controls retain aria-label, data-tooltip, and title fallbacks", () => {
  for (const [attribute, value, type] of [
    ["data-tooltip", "Not starred", "starVisibleGmailThread"],
    ["title", "Starred", "unstarVisibleGmailThread"],
  ]) {
    let metadataListener;
    let clicked = 0;
    const control = {
      click: () => { clicked += 1; },
      getAttribute: (name) => name === attribute ? value : null,
    };
    const latest = {
      getAttribute: () => null,
      getClientRects: () => [{}],
      querySelector: () => null,
      querySelectorAll: (selector) => selector === "[aria-label], [data-tooltip], [title], [tooltip]"
        ? [control]
        : [],
    };
    vm.runInNewContext(`${messagingSource}\n${bridgeSource}`, {
      URL,
      chrome: {
        runtime: { onMessage: { addListener: (listener) => { metadataListener = listener; } } },
      },
      decodeURIComponent,
      document: { querySelectorAll: () => [latest] },
      window: {
        location: {
          hostname: "mail.google.com",
          href: "https://mail.google.com/mail/u/0/#all/FMexact",
        },
      },
    });
    let response;
    metadataListener(
      { threadRef: "FMexact", type },
      null,
      (result) => { response = result; },
    );
    assert.equal(response.ok, true);
    assert.equal(clicked, 1);
  }
});

test("omnibox Gmail URL drop requests exact-tab metadata for row-create", async () => {
  let request;
  const gmailParticipants = {
    from: { email: "kayla@example.com", name: "Kayla" },
    to: [{ email: "me@example.com", name: "Me" }],
  };
  const context = playhouseContext(async (message) => {
    request = message;
    return {
      gmailApiThreadId: "api-thread-123",
      gmailApiThreadStrategy: "conversation_header",
      gmailParticipants,
      gmailSubject: "Quarterly planning",
      returnedThreadRef: "FMexact",
    };
  });

  context.drop(dataTransfer({
    "text/uri-list": "https://mail.google.com/mail/u/2/#inbox/FMexact",
  }));
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    accountIndex: 2,
    canonicalUrl: "https://mail.google.com/mail/u/2/#all/FMexact",
    correlationId: "correlation-1",
    threadRef: "FMexact",
    type: "getGmailThreadParticipants",
  });
  assert.deepEqual(JSON.parse(context.dispatched().detail), {
    correlationId: "correlation-1",
    gmailApiThreadId: "api-thread-123",
    gmailApiThreadStrategy: "conversation_header",
    gmailDragSource: "opened_conversation",
    gmailParticipants,
    subject: "Quarterly planning",
    targetPlayId: "play-1",
    url: "https://mail.google.com/mail/u/2/#all/FMexact",
  });
  assert.equal(context.dispatched().type, "carnival:gmail-row-create");
});

test("row-create waits for asynchronous exact-tab metadata and retains its target", async () => {
  let resolveMetadata;
  const metadata = new Promise((resolve) => { resolveMetadata = resolve; });
  const context = playhouseContext(() => metadata);

  context.drop(dataTransfer({
    "text/uri-list": "https://mail.google.com/mail/u/2/#inbox/FMexact",
  }));
  await Promise.resolve();
  assert.equal(context.dispatched(), undefined);

  resolveMetadata({
    gmailApiThreadId: "api-thread-123",
    gmailApiThreadStrategy: "conversation_header",
    gmailDragSource: "opened_conversation",
    participants: {
      from: { email: "kayla@example.com", name: "Kayla" },
      to: [{ email: "me@example.com", name: "Me" }],
    },
    subject: "Quarterly planning",
    threadRef: "FMexact",
  });
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(context.dispatched().type, "carnival:gmail-row-create");
  assert.deepEqual(JSON.parse(context.dispatched().detail), {
    correlationId: "correlation-1",
    gmailApiThreadId: "api-thread-123",
    gmailApiThreadStrategy: "conversation_header",
    gmailDragSource: "opened_conversation",
    gmailParticipants: {
      from: { email: "kayla@example.com", name: "Kayla" },
      to: [{ email: "me@example.com", name: "Me" }],
    },
    subject: "Quarterly planning",
    targetPlayId: "play-1",
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

test("PlayHouse requests exact-thread unstar and preserves lifecycle context", async () => {
  let request;
  const context = playhouseContext(async (message) => {
    request = message;
    return { ok: true };
  });
  context.windowEvent("carnival:gmail-unstar-thread", JSON.stringify({
    accountIndex: 2,
    action: "trash",
    correlationId: "correlation-1",
    playId: "play-1",
    threadRef: "FMexact",
  }));
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    accountIndex: 2,
    action: "trash",
    correlationId: "correlation-1",
    playId: "play-1",
    threadRef: "FMexact",
    type: "unstarGmailThread",
  });
  assert.equal(context.dispatched().type, "carnival:gmail-unstar-result");
  assert.deepEqual(JSON.parse(context.dispatched().detail), {
    accountIndex: 2,
    action: "trash",
    correlationId: "correlation-1",
    ok: true,
    playId: "play-1",
    threadRef: "FMexact",
  });
});

test("list-row structured drag creates through the existing PlayHouse row path", async () => {
  const requests = [];
  const context = playhouseContext(async (message) => {
    requests.push(message);
    return { status: "consumed" };
  });
  const payload = {
    correlationId: "list-correlation-1",
    gmailApiThreadId: "1a0ad6003af12a6b",
    gmailApiThreadStrategy: "direct",
    gmailDragSource: "list_row",
    gmailParticipants: {
      from: { email: "person@example.com", name: "Person" },
      to: [],
    },
    subject: "List subject",
    url: "https://mail.google.com/mail/u/2/#all/%23thread-f%3A123456789",
  };

  context.drop(dataTransfer({
    "application/x-carnival-gmail": JSON.stringify(payload),
    "text/uri-list": payload.url,
  }));
  await Promise.resolve();

  assert.deepEqual(JSON.parse(context.dispatched().detail), {
    correlationId: "list-correlation-1",
    gmailApiThreadId: "1a0ad6003af12a6b",
    gmailApiThreadStrategy: "direct",
    gmailDragSource: "list_row",
    gmailParticipants: payload.gmailParticipants,
    subject: "List subject",
    targetPlayId: "play-1",
    url: payload.url,
  });
  assert.equal(context.dispatched().type, "carnival:gmail-row-create");
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{
    correlationId: "list-correlation-1",
    type: "consumeGmailListRowDrag",
  }]);
});

test("list-row drag uses the session handoff when Chrome strips custom MIME", async () => {
  const payload = {
    correlationId: "list-correlation-1",
    gmailApiThreadId: "1a0ad6003af12a6b",
    gmailApiThreadStrategy: "direct",
    gmailDragSource: "list_row",
    subject: "List subject",
    url: "https://mail.google.com/mail/u/2/#all/%23thread-f%3A123456789",
  };
  const requests = [];
  const context = playhouseContext(async (message) => {
    requests.push(message);
    return message.type === "getGmailListRowDrag"
      ? { payload, status: "found" }
      : { status: "consumed" };
  });

  context.drop(dataTransfer({ "text/uri-list": payload.url }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(context.dispatched().type, "carnival:gmail-row-create");
  assert.deepEqual(JSON.parse(context.dispatched().detail), {
    correlationId: "list-correlation-1",
    gmailApiThreadId: "1a0ad6003af12a6b",
    gmailApiThreadStrategy: "direct",
    gmailDragSource: "list_row",
    subject: "List subject",
    targetPlayId: "play-1",
    url: payload.url,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    { type: "getGmailListRowDrag" },
    { correlationId: "list-correlation-1", type: "consumeGmailListRowDrag" },
  ]);
});

test("unstar returns a controlled stale-context failure without throwing", async () => {
  const context = playhouseContext(() => {
    throw new Error("Extension context invalidated.");
  });
  assert.doesNotThrow(() => context.windowEvent("carnival:gmail-unstar-thread", JSON.stringify({
    accountIndex: 2,
    action: "trash",
    correlationId: "correlation-1",
    playId: "play-1",
    threadRef: "FMexact",
  })));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(context.dispatched().type, "carnival:gmail-unstar-result");
  assert.deepEqual(JSON.parse(context.dispatched().detail), {
    accountIndex: 2,
    action: "trash",
    code: "EXTENSION_CONTEXT_UNAVAILABLE",
    correlationId: "correlation-1",
    message: "Carnival extension was reloaded. Refresh PlayHouse.",
    ok: false,
    playId: "play-1",
    reason: "EXTENSION_CONTEXT_UNAVAILABLE",
    threadRef: "FMexact",
  });
});

test("metadata failure emits no create event or malformed Play request", async () => {
  const context = playhouseContext(async () => {
    throw new Error("matching Gmail tab unavailable");
  });

  context.drop(dataTransfer({
    "text/plain": "https://mail.google.com/mail/u/0/#all/FMonly",
  }));
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(context.dispatched().type, "carnival:gmail-row-create-metadata-failed");
  assert.deepEqual(JSON.parse(context.dispatched().detail), {
    code: "RUNTIME_MESSAGE_FAILED",
    correlationId: "correlation-1",
    message: "matching Gmail tab unavailable",
    reason: "thread_mismatch",
    targetPlayId: "play-1",
  });
});
