import { describe, expect, it, vi } from "vitest";

import { applyPlayLifecycle } from "./gmail-lifecycle";

describe("Gmail Play lifecycle", () => {
  it("unstars a Gmail thread before applying local done semantics", async () => {
    const order: string[] = [];
    const unstarThread = vi.fn(async () => {
      order.push("gmail");
      return { success: true as const };
    });
    const setLocalStatus = vi.fn(async () => {
      order.push("local");
      return true;
    });

    const result = await applyPlayLifecycle({
      gmailThreadId: "thread-1",
      setLocalStatus,
      sourceType: "gmail",
      status: "done",
      unstarThread,
    });

    expect(result).toEqual({ success: true });
    expect(order).toEqual(["gmail", "local"]);
    expect(unstarThread).toHaveBeenCalledWith("thread-1");
    expect(setLocalStatus).toHaveBeenCalledWith("done");
  });

  it("trashes locally before best-effort Gmail sync", async () => {
    const order: string[] = [];
    const result = await applyPlayLifecycle({
      gmailThreadId: "thread-1",
      setLocalStatus: vi.fn(async () => {
        order.push("local");
        return true;
      }),
      sourceType: "gmail",
      status: "trash",
      unstarThread: vi.fn(async () => {
        order.push("gmail");
        return { success: true as const };
      }),
    });

    expect(result).toEqual({ success: true });
    expect(order).toEqual(["local", "gmail"]);
  });

  it("treats an already-unstarred successful response as idempotent", async () => {
    const setLocalStatus = vi.fn().mockResolvedValue(true);
    const result = await applyPlayLifecycle({
      gmailThreadId: "thread-1",
      setLocalStatus,
      sourceType: "gmail",
      status: "done",
      unstarThread: vi.fn().mockResolvedValue({ success: true }),
    });

    expect(result).toEqual({ success: true });
    expect(setLocalStatus).toHaveBeenCalledOnce();
  });

  it("keeps the Play trashed when Gmail unstar fails", async () => {
    const setLocalStatus = vi.fn().mockResolvedValue(true);
    const result = await applyPlayLifecycle({
      gmailThreadId: "thread-1",
      setLocalStatus,
      sourceType: "gmail",
      status: "trash",
      unstarThread: vi.fn().mockResolvedValue({
        message: "Gmail failed. The Play was left active.",
        success: false,
      }),
    });

    expect(result).toEqual({
      success: true,
      warning: "Play trashed. Gmail sync could not be completed.",
    });
    expect(setLocalStatus).toHaveBeenCalledWith("trash");
  });

  it("keeps the Play trashed when Gmail sync throws", async () => {
    const setLocalStatus = vi.fn().mockResolvedValue(true);
    const result = await applyPlayLifecycle({
      gmailThreadId: "thread-1",
      setLocalStatus,
      sourceType: "gmail",
      status: "trash",
      unstarThread: vi.fn().mockRejectedValue(new Error("network unavailable")),
    });

    expect(result).toEqual({
      success: true,
      warning: "Play trashed. Gmail sync could not be completed.",
    });
    expect(setLocalStatus).toHaveBeenCalledWith("trash");
  });

  it("does not call Gmail when the local trash update fails", async () => {
    const unstarThread = vi.fn();
    const result = await applyPlayLifecycle({
      gmailThreadId: "thread-1",
      setLocalStatus: vi.fn().mockResolvedValue(false),
      sourceType: "gmail",
      status: "trash",
      unstarThread,
    });

    expect(result).toEqual({
      message: "The Play could not be updated. Refresh and try again.",
      success: false,
    });
    expect(unstarThread).not.toHaveBeenCalled();
  });

  it("rejects a Gmail Play without a thread identifier", async () => {
    const setLocalStatus = vi.fn().mockResolvedValue(true);
    const unstarThread = vi.fn();
    const result = await applyPlayLifecycle({
      gmailThreadId: " ",
      setLocalStatus,
      sourceType: "gmail",
      status: "done",
      unstarThread,
    });

    expect(result.success).toBe(false);
    expect(unstarThread).not.toHaveBeenCalled();
    expect(setLocalStatus).not.toHaveBeenCalled();
  });

  it("does not call Gmail for a non-Gmail Play", async () => {
    const setLocalStatus = vi.fn().mockResolvedValue(true);
    const unstarThread = vi.fn();
    const result = await applyPlayLifecycle({
      gmailThreadId: "thread-ignored",
      setLocalStatus,
      sourceType: "user",
      status: "done",
      unstarThread,
    });

    expect(result).toEqual({ success: true });
    expect(unstarThread).not.toHaveBeenCalled();
    expect(setLocalStatus).toHaveBeenCalledOnce();
  });
});
