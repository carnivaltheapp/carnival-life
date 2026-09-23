import assert from "node:assert/strict";
import test from "node:test";
import {
  AUX_ROLE_ORDER, AUX_ROLE_URLS, HOT_TAB_ROLES, auxRoleForUrl, canonicalAuxTabs,
  defaultAuxTabs, defaultMiscTabs, isGoogleContactsUrl, isSlackUrl,
  isRestorableTabUrl, snapshotTabs, validSavedTabs,
} from "./workspace-tabs.js";

test("fresh Aux contains exactly the five canonical Hot Tabs in fixed order", () => {
  assert.deepEqual(AUX_ROLE_ORDER, ["calendar", "gmail", "contacts", "slack", "play"]);
  assert.deepEqual(defaultAuxTabs().tabs.map(({ role, url }) => ({ role, url })), [
    { role: "calendar", url: AUX_ROLE_URLS.calendar },
    { role: "gmail", url: AUX_ROLE_URLS.gmail },
    { role: "contacts", url: AUX_ROLE_URLS.contacts },
    { role: "slack", url: AUX_ROLE_URLS.slack },
    { role: "play", url: AUX_ROLE_URLS.play },
  ]);
  assert.deepEqual(HOT_TAB_ROLES, Object.fromEntries(AUX_ROLE_ORDER.map((role) => [role, role])));
});

test("Misc is an ordinary restorable browser session", () => {
  assert.deepEqual(defaultMiscTabs(), {
    activeIndex: 0, tabs: [{ pinned: false, role: null, url: "https://www.google.com/" }],
  });
  assert.deepEqual(validSavedTabs({ activeIndex: 1, tabs: [
    { pinned: true, role: "gmail", url: "https://example.com/one" },
    { pinned: false, role: "calendar", url: "https://example.com/two" },
  ] }, "misc"), { activeIndex: 1, tabs: [
    { pinned: true, role: null, url: "https://example.com/one" },
    { pinned: false, role: null, url: "https://example.com/two" },
  ] });
});

test("legacy Drive and Misc roles migrate to the canonical Play Hot Tab", () => {
  for (const role of ["drive", "misc"]) assert.equal(validSavedTabs({ activeIndex: 0, tabs: [
    { role, url: "https://drive.google.com/drive/folders/ABC123" },
  ] }, "context").tabs[0].role, "play");
});

test("canonical Aux restoration fills missing roles and discards arbitrary extras", () => {
  const restored = canonicalAuxTabs({ activeIndex: 0, tabs: [
    { role: "gmail", url: "https://mail.google.com/mail/u/1/#sent" },
    { role: null, url: "https://example.com/" },
  ] });
  assert.deepEqual(restored.tabs.map((tab) => tab.role), AUX_ROLE_ORDER);
  assert.equal(restored.tabs[1].url, "https://mail.google.com/mail/u/1/#sent");
  assert.equal(restored.tabs.some((tab) => tab.url === "https://example.com/"), false);
});

test("logical snapshots preserve order, active tab, pins, and durable roles", () => {
  assert.deepEqual(snapshotTabs([
    { active: true, id: 12, index: 0, pinned: false, url: "https://mail.google.com/thread" },
    { active: false, id: 10, index: 1, pinned: true, url: "https://calendar.google.com/" },
    { active: false, id: 13, index: 2, pinned: false, url: "https://docs.google.com/" },
  ], { calendar: 10, gmail: 12 }), { activeIndex: 0, tabs: [
    { pinned: false, role: "gmail", url: "https://mail.google.com/thread" },
    { pinned: true, role: "calendar", url: "https://calendar.google.com/" },
    { pinned: false, role: null, url: "https://docs.google.com/" },
  ] });
});

test("saved definitions reject transient or privileged URLs", () => {
  assert.equal(isRestorableTabUrl("about:blank"), false);
  assert.equal(isRestorableTabUrl("chrome://newtab"), false);
  assert.equal(isRestorableTabUrl("https://example.com"), true);
});

test("semantic URLs select canonical Aux roles and other web URLs use Play", () => {
  assert.equal(auxRoleForUrl("https://calendar.google.com/calendar/u/0/r"), "calendar");
  assert.equal(auxRoleForUrl("https://mail.google.com/mail/u/2/#all/thread"), "gmail");
  assert.equal(auxRoleForUrl("https://contacts.google.com/person/c123"), "contacts");
  assert.equal(auxRoleForUrl("https://app.slack.com/client/T1/C1"), "slack");
  assert.equal(auxRoleForUrl("https://drive.google.com/drive/folders/ABC123"), "play");
  assert.equal(auxRoleForUrl("https://example.com/play"), "play");
  assert.equal(auxRoleForUrl("chrome://settings"), null);
});

test("Slack and Contacts hostname matching remains exact", () => {
  assert.equal(isSlackUrl("https://app.slack.com/client/T1/C1"), true);
  assert.equal(isSlackUrl("https://example.com/slack"), false);
  assert.equal(isGoogleContactsUrl("https://contacts.google.com/?hl=en&tab=CC"), true);
  assert.equal(isGoogleContactsUrl("https://mail.google.com/"), false);
});
