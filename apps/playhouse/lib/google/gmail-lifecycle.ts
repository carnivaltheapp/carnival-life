import type { PlaySourceType } from "../../domain/play";

export type GmailLifecycleResult =
  | { success: true; warning?: string }
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
  if (status === "trash") {
    if (!await setLocalStatus(status)) {
      return {
        message: "The Play could not be updated. Refresh and try again.",
        success: false,
      };
    }
    if (sourceType !== "gmail") return { success: true };

    const threadId = gmailThreadId?.trim();
    if (!threadId) {
      return { success: true, warning: "Play trashed. Gmail sync could not be completed." };
    }
    try {
      const unstarred = await unstarThread(threadId);
      return unstarred.success
        ? { success: true }
        : { success: true, warning: "Play trashed. Gmail sync could not be completed." };
    } catch {
      return { success: true, warning: "Play trashed. Gmail sync could not be completed." };
    }
  }

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
