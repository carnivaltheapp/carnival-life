export type GmailLifecycleAction = "done" | "trash";
export type GmailLifecycleReason =
  | "account_disconnected"
  | "account_missing"
  | "api_thread_missing"
  | "completed"
  | "gmail_permission_denied"
  | "gmail_permission_missing"
  | "gmail_trash_failed"
  | "gmail_unstar_failed"
  | "token_unavailable";

export type GmailLifecycleStepResult = {
  attempted: boolean;
  reason: GmailLifecycleReason;
  success: boolean;
};

export type GmailLifecycleCleanupResult = {
  accountResolved: boolean;
  trash: GmailLifecycleStepResult | null;
  unstar: GmailLifecycleStepResult;
};

export type PlayLifecycleResult = {
  cleanup?: GmailLifecycleCleanupResult;
  persisted: boolean;
};

export async function applyPlayLifecycle({
  gmailLinked,
  onPersisted,
  persist,
  syncGmail,
}: {
  gmailLinked: boolean;
  onPersisted?: () => Promise<void>;
  persist: () => Promise<boolean>;
  syncGmail: () => Promise<GmailLifecycleCleanupResult>;
}): Promise<PlayLifecycleResult> {
  const persisted = await persist();
  if (!persisted) return { persisted: false };
  await onPersisted?.();
  if (!gmailLinked) return { persisted: true };
  return { cleanup: await syncGmail(), persisted: true };
}
