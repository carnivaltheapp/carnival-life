"use client";

import type { PlayListItem } from "../domain/play";
import { recordGmailOutgoingSync } from "../app/plays/actions";

export type GmailUnstarAction = "done" | "trash";

export function requestGmailThreadUnstar(
  play: PlayListItem,
  action: GmailUnstarAction,
) {
  void recordGmailOutgoingSync({
    apiThreadIdPresent: Boolean(play.gmailApiThreadId),
    operation: "unstar",
    playId: play.id,
    stage: "GMAIL_OUTGOING_SYNC_REQUESTED",
    webThreadRefPresent: Boolean(play.gmailWebThreadRef),
  });
  if (!play.gmailWebThreadRef) {
    void recordGmailOutgoingSync({
      apiThreadIdPresent: Boolean(play.gmailApiThreadId),
      operation: "unstar",
      playId: play.id,
      reason: "web_thread_ref_missing",
      stage: "GMAIL_OUTGOING_SYNC_RESULT",
      success: false,
      webThreadRefPresent: false,
    });
    console.warn("GMAIL_UNSTAR_FAILED", {
      action,
      playId: play.id,
      reason: "web_thread_ref_missing",
    });
    window.dispatchEvent(new CustomEvent("carnival:gmail-unstar-result", {
      detail: JSON.stringify({
        action,
        apiThreadIdPresent: Boolean(play.gmailApiThreadId),
        diagnosticRecorded: true,
        ok: false,
        playId: play.id,
        reason: "web_thread_ref_missing",
        webThreadRefPresent: false,
      }),
    }));
    return false;
  }
  const correlationId = crypto.randomUUID();
  console.info("GMAIL_UNSTAR_STARTED", {
    action,
    playId: play.id,
    webThreadRefPresent: true,
  });
  window.dispatchEvent(new CustomEvent("carnival:gmail-unstar-thread", {
    detail: JSON.stringify({
      accountIndex: play.gmailAccountIndex ?? 0,
      action,
      correlationId,
      apiThreadIdPresent: Boolean(play.gmailApiThreadId),
      playId: play.id,
      threadRef: play.gmailWebThreadRef,
      webThreadRefPresent: true,
    }),
  }));
  return true;
}
