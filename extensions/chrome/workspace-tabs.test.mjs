import assert from "node:assert/strict";
import test from "node:test";

import {
  AUX_ROLE_URLS,
  HOT_TAB_ROLES,
  auxRoleForUrl,
  createPhSessionDiagnosticTrail,
  defaultAuxTabs,
  defaultMiscTabs,
  isGoogleContactsUrl,
  isSlackUrl,
  isRestorableTabUrl,
  safePhSessionSnapshot,
  snapshotTabs,
  validSavedTabs,
} from "./workspace-tabs.js";

test("PH session diagnostics retain order and state without exposing raw URLs", async () => {
  const rawUrl = "https://example.com/private/path?token=do-not-log#secret";
  const snapshot = await safePhSessionSnapshot({
    activeIndex: 1,
    tabs: [
      { pinned: true, url: "https://carnival-playhouse.vercel.app/?view=today" },
      { pinned: false, url: rawUrl },
    ],
  });

  assert.equal(snapshot.tab_count, 2);
  assert.equal(snapshot.active_index, 1);
  assert.deepEqual(snapshot.pinned_indexes, [0]);
  assert.equal(snapshot.tabs[0].is_playhouse, true);
  assert.equal(snapshot.tabs[1].hostname, "example.com");
  assert.match(snapshot.tabs[1].url_fingerprint, /^[a-f0-9]{64}$/);
  assert.match(snapshot.snapshot_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(snapshot).includes(rawUrl), false);
  assert.equal(JSON.stringify(snapshot).includes("private/path"), false);
  assert.equal(JSON.stringify(snapshot).includes("do-not-log"), false);
});

test("PH session diagnostic recording is ordered, persistent, and failure-safe", async () => {
  const records = [];
  const trail = createPhSessionDiagnosticTrail({
    async record(event, details) { records.push({ details, event }); },
  });
  const snapshot = {
    activeIndex: 0,
    tabs: [{ pinned: false, url: "https://example.com/private" }],
  };

  trail.record("PH_SESSION_SNAPSHOT_CREATED", { reason: "tab-created", snapshot });
  trail.record("PH_SESSION_PERSIST_RESULT", { reason: "completed", snapshot, success: true });
  trail.record("PH_WINDOW_REMOVED", { reason: "window-closing", snapshot });
  await trail.drain();

  assert.deepEqual(records.map(({ event }) => event), [
    "PH_SESSION_SNAPSHOT_CREATED",
    "PH_SESSION_PERSIST_RESULT",
    "PH_WINDOW_REMOVED",
  ]);
  assert.deepEqual(records.map(({ details }) => details.reason), [
    "tab_created",
    "completed",
    "window_closing",
  ]);
  assert.equal(JSON.stringify(records).includes("https://example.com/private"), false);

  const failingTrail = createPhSessionDiagnosticTrail({
    record() { throw new Error("diagnostic storage unavailable"); },
  });
  assert.doesNotThrow(() => failingTrail.record("PH_SESSION_SNAPSHOT_CREATED", { snapshot }));
  await assert.doesNotReject(failingTrail.drain());
});

test("fresh Aux defines exactly five canonical Hot Tabs in order", () => {
  assert.deepEqual(defaultAuxTabs(), {
    activeIndex: 0,
    tabs: [
      { pinned: false, role: "calendar", url: AUX_ROLE_URLS.calendar },
      { pinned: false, role: "gmail", url: AUX_ROLE_URLS.gmail },
      { pinned: false, role: "contacts", url: AUX_ROLE_URLS.contacts },
      { pinned: false, role: "slack", url: AUX_ROLE_URLS.slack },
      { pinned: false, role: "misc", url: AUX_ROLE_URLS.misc },
    ],
  });
});

test("Hot Tabs have canonical durable roles while URL retains the compatible Misc role", () => {
  assert.deepEqual(HOT_TAB_ROLES, {
    calendar: "calendar",
    drive: "misc",
    gmail: "gmail",
    contacts: "contacts",
    slack: "slack",
    url: "misc",
  });
});

test("fresh Misc is an unrestricted restorable browser session", () => {
  assert.deepEqual(defaultMiscTabs(), {
    activeIndex: 0,
    tabs: [{ pinned: false, role: null, url: AUX_ROLE_URLS.misc }],
  });
});

test("a saved Drive role remains identifiable after Aux restoration", () => {
  assert.deepEqual(validSavedTabs({
    activeIndex: 0,
    tabs: [{ role: "drive", url: "https://drive.google.com/drive/folders/ABC123" }],
  }, "context"), {
    activeIndex: 0,
    tabs: [{
      pinned: false,
      role: "drive",
      url: "https://drive.google.com/drive/folders/ABC123",
    }],
  });
});

test("logical snapshots preserve order, active tab, pins, and durable roles", () => {
  assert.deepEqual(snapshotTabs([
    { active: true, id: 12, index: 0, pinned: false, url: "https://mail.google.com/thread" },
    { active: false, id: 10, index: 1, pinned: true, url: "https://calendar.google.com/" },
    { active: false, id: 13, index: 2, pinned: false, url: "https://docs.google.com/" },
  ], { calendar: 10, gmail: 12 }), {
    activeIndex: 0,
    tabs: [
      { pinned: false, role: "gmail", url: "https://mail.google.com/thread" },
      { pinned: true, role: "calendar", url: "https://calendar.google.com/" },
      { pinned: false, role: null, url: "https://docs.google.com/" },
    ],
  });
});

test("saved definitions reject transient or privileged URLs", () => {
  assert.equal(isRestorableTabUrl("about:blank"), false);
  assert.equal(isRestorableTabUrl("chrome://newtab"), false);
  assert.equal(isRestorableTabUrl("chrome-extension://temporary"), false);
  assert.deepEqual(validSavedTabs({
    activeIndex: 2,
    tabs: [
      { role: "gmail", url: "about:blank" },
      { role: "misc", url: "https://example.com/" },
    ],
  }, "context"), {
    activeIndex: 0,
    tabs: [{ pinned: false, role: "misc", url: "https://example.com/" }],
  });
  assert.deepEqual(validSavedTabs({
    activeIndex: 1,
    tabs: [
      { role: "gmail", url: "about:blank" },
      { role: null, url: "https://docs.google.com/" },
      { role: "misc", url: "https://example.com/" },
    ],
  }, "context"), {
    activeIndex: 0,
    tabs: [
      { pinned: false, role: null, url: "https://docs.google.com/" },
      { pinned: false, role: "misc", url: "https://example.com/" },
    ],
  });
});

test("Aux routing selects durable Calendar, Drive, Gmail, and Contacts roles and Misc otherwise", () => {
  assert.equal(auxRoleForUrl("https://calendar.google.com/calendar/u/0/r/week"), "calendar");
  assert.equal(auxRoleForUrl("https://mail.google.com/mail/u/2/#all/thread"), "gmail");
  assert.equal(auxRoleForUrl("https://contacts.google.com/person/c123"), "contacts");
  assert.equal(auxRoleForUrl("https://drive.google.com/drive/folders/ABC123"), "drive");
  assert.equal(auxRoleForUrl("https://app.slack.com/client/T1/C1"), "slack");
  assert.equal(auxRoleForUrl("https://example.com/play"), "misc");
  assert.equal(auxRoleForUrl("chrome://settings"), null);
});

test("Slack matching accepts Slack hostnames only", () => {
  assert.equal(isSlackUrl("https://app.slack.com/client/T1/C1"), true);
  assert.equal(isSlackUrl("https://carnival.slack.com/archives/C1"), true);
  assert.equal(isSlackUrl("https://example.com/slack"), false);
});

test("Google Contacts matching uses the exact hostname regardless of path, query, or hash", () => {
  assert.equal(isGoogleContactsUrl("https://contacts.google.com/?hl=en&tab=CC"), true);
  assert.equal(isGoogleContactsUrl("https://contacts.google.com/person/c123#details"), true);
  assert.equal(isGoogleContactsUrl("https://contacts.google.com/u/0/person/c456"), true);
  assert.equal(isGoogleContactsUrl("https://google.com/"), false);
  assert.equal(isGoogleContactsUrl("https://gmail.google.com/"), false);
  assert.equal(isGoogleContactsUrl("https://mail.google.com/"), false);
});
