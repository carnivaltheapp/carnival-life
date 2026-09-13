import assert from "node:assert/strict";
import test from "node:test";

import {
  gmailTabIdentity,
  selectGmailMetadataTab,
  verifyVisibleGmailParticipants,
} from "./gmail-tab-metadata.js";

test("Gmail tab identity reads account and browser thread reference", () => {
  assert.deepEqual(
    gmailTabIdentity("https://mail.google.com/mail/u/2/#inbox/FMfcExact"),
    { accountIndex: 2, threadRef: "FMfcExact" },
  );
});

test("visible participant metadata requires an exact returned thread reference", () => {
  const gmailParticipants = {
    from: { email: "kayla@example.com", name: "Kayla" },
    to: [{ email: "me@example.com", name: "Me" }],
  };
  assert.deepEqual(
    verifyVisibleGmailParticipants({ gmailParticipants, threadRef: "FMwrong" }, "FMexpected"),
    { gmailParticipants: null, status: "thread_mismatch" },
  );
  assert.deepEqual(
    verifyVisibleGmailParticipants({ gmailParticipants, threadRef: "FMexpected" }, "FMexpected"),
    { gmailParticipants, status: "resolved" },
  );
  assert.deepEqual(
    verifyVisibleGmailParticipants({ gmailParticipants: null, threadRef: "FMexpected" }, "FMexpected"),
    { gmailParticipants: null, status: "participants_unavailable" },
  );
});

test("metadata lookup requires exact account and thread and prefers its active tab", () => {
  const selected = selectGmailMetadataTab([
    { active: true, id: 1, url: "https://mail.google.com/mail/u/1/#all/FMfcExact" },
    { active: true, id: 2, url: "https://mail.google.com/mail/u/0/#all/FMwrong" },
    { active: false, id: 3, url: "https://mail.google.com/mail/u/0/#inbox/FMfcExact" },
    { active: true, id: 4, url: "https://mail.google.com/mail/u/0/#all/FMfcExact" },
  ], { accountIndex: 0, threadRef: "FMfcExact" });

  assert.equal(selected.id, 4);
  assert.equal(
    selectGmailMetadataTab([
      { active: true, id: 5, url: "https://mail.google.com/mail/u/0/#all/FMwrong" },
    ], { accountIndex: 0, threadRef: "FMfcExact" }),
    null,
  );
});
