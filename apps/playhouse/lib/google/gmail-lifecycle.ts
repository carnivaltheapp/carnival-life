import type { PlaySourceType } from "../../domain/play";

export type GmailLifecycleResult =
  | { success: true }
  | { message: string; success: false };

export async function applyPlayLifecycle({
  gmailThreadId,
  setLocalStatus,
  sourceType,
  status,
  unstarThread,
}: {
  gmailThreadId: string | null | undefined;
  setLocalStatus: (status: "done" | "trash") => Promise<boolean>;
  sourceType: PlaySourceType;
  status: "done" | "trash";
  unstarThread: (threadId: string) => Promise<GmailLifecycleResult>;
}): Promise<GmailLifecycleResult> {
  if (sourceType === "gmail") {
    const threadId = gmailThreadId?.trim();
    if (!threadId) {
      return {
        message: "This Gmail Play is missing its Gmail thread link and was left active.",
        success: false,
      };
    }
    const unstarred = await unstarThread(threadId);
    if (!unstarred.success) return unstarred;
  }

  return await setLocalStatus(status)
    ? { success: true }
    : {
        message: "The Play could not be updated. Refresh and try again.",
        success: false,
      };
}
