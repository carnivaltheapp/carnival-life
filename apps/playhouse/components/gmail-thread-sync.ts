"use client";

import type { PlayListItem } from "../domain/play";

export type GmailUnstarAction = "done" | "trash";

export function requestGmailThreadUnstar(
  play: PlayListItem,
  action: GmailUnstarAction,
) {
  if (!play.gmailThreadId) return false;
  const correlationId = crypto.randomUUID();
  console.info("GMAIL_UNSTAR_STARTED", {
    action,
    playId: play.id,
    threadRef: play.gmailThreadId,
  });
  window.dispatchEvent(new CustomEvent("carnival:gmail-unstar-thread", {
    detail: JSON.stringify({
      accountIndex: play.gmailAccountIndex ?? 0,
      action,
      correlationId,
      playId: play.id,
      threadRef: play.gmailThreadId,
    }),
  }));
  return true;
}
