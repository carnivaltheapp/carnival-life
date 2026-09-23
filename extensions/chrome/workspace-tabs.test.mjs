import assert from "node:assert/strict";
import test from "node:test";

import {
  AUX_ROLE_URLS,
  HOT_TAB_ROLES,
  auxRoleForUrl,
  defaultAuxTabs,
  isGoogleContactsUrl,
  isSlackUrl,
  isRestorableTabUrl,
  snapshotTabs,
  validSavedTabs,
} from "./workspace-tabs.js";

test("fresh Aux defines Calendar, Gmail, and Misc role tabs in order", () => {
  assert.deepEqual(defaultAuxTabs(), {
    activeIndex: 0,
    tabs: [
      { pinned: false, role: "calendar", url: AUX_ROLE_URLS.calendar },
      { pinned: false, role: "gmail", url: AUX_ROLE_URLS.gmail },
      { pinned: false, role: "misc", url: AUX_ROLE_URLS.misc },
    ],
  });
});

test("Hot Tabs have canonical durable roles while URL retains the compatible Misc role", () => {
  assert.deepEqual(HOT_TAB_ROLES, {
    calendar: "calendar",
    drive: "drive",
    gmail: "gmail",
    slack: "slack",
    url: "misc",
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
