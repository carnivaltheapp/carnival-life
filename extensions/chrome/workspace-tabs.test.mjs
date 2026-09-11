import assert from "node:assert/strict";
import test from "node:test";

import {
  AUX_ROLE_URLS,
  auxRoleForUrl,
  defaultAuxTabs,
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

test("Aux routing selects Gmail only for Gmail URLs and Misc otherwise", () => {
  assert.equal(auxRoleForUrl("https://mail.google.com/mail/u/2/#all/thread"), "gmail");
  assert.equal(auxRoleForUrl("https://example.com/play"), "misc");
  assert.equal(auxRoleForUrl("chrome://settings"), null);
});
