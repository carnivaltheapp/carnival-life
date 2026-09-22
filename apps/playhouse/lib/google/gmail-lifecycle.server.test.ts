import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getGoogleAccessToken, starGmailThread, trashGmailThread, unstarGmailThread, untrashGmailThread } = vi.hoisted(() => ({
  getGoogleAccessToken: vi.fn().mockResolvedValue("access-token"),
  starGmailThread: vi.fn().mockResolvedValue(undefined),
  trashGmailThread: vi.fn().mockResolvedValue(undefined),
  unstarGmailThread: vi.fn().mockResolvedValue(undefined),
  untrashGmailThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./token-broker.server", () => ({ getGoogleAccessToken }));
vi.mock("./gmail", () => ({
  GmailApiError: class GmailApiError extends Error {
    constructor(public readonly status: number) {
      super("gmail error");
    }
  },
  starGmailThread,
  trashGmailThread,
  unstarGmailThread,
  untrashGmailThread,
}));

import {
  restoreGmailThreadForManualLink,
  resolveGmailLifecycleContext,
  syncGmailPlayLifecycle,
} from "./gmail-lifecycle.server";
import { GOOGLE_GMAIL_MODIFY_SCOPE } from "./scopes";

function supabaseAccounts(accounts: unknown[]) {
  const chain = {
    eq: vi.fn(),
    order: vi.fn().mockResolvedValue({ data: accounts, error: null }),
    select: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return { from: vi.fn().mockReturnValue(chain) } as never;
}

describe("server Gmail lifecycle cleanup", () => {
  beforeEach(() => {
    getGoogleAccessToken.mockClear();
    trashGmailThread.mockClear();
    unstarGmailThread.mockClear();
    starGmailThread.mockClear();
    untrashGmailThread.mockClear();
  });

  it("resolves the owner-scoped connected account with gmail.modify", async () => {
    await expect(resolveGmailLifecycleContext({
      accountIndex: 0,
      ownerUserId: "owner-1",
      supabase: supabaseAccounts([{
        connection_status: "connected",
        granted_scopes: [GOOGLE_GMAIL_MODIFY_SCOPE],
        id: "account-1",
      }]),
    })).resolves.toEqual({
      accountResolved: true,
      googleAccountId: "account-1",
      reason: null,
    });
  });

  it("Done unstars by API thread ID and never Gmail-trashes", async () => {
    const result = await syncGmailPlayLifecycle({
      action: "done",
      apiThreadId: "api-thread-1",
      context: { accountResolved: true, googleAccountId: "account-1", reason: null },
      ownerUserId: "owner-1",
    });

    expect(result.unstar).toEqual({ attempted: true, reason: "completed", success: true });
    expect(result.trash).toBeNull();
    expect(unstarGmailThread).toHaveBeenCalledWith({
      accessToken: "access-token",
      threadId: "api-thread-1",
    });
    expect(trashGmailThread).not.toHaveBeenCalled();
  });

  it("Trash independently unstars and Gmail-trashes by API thread ID", async () => {
    const result = await syncGmailPlayLifecycle({
      action: "trash",
      apiThreadId: "api-thread-1",
      context: { accountResolved: true, googleAccountId: "account-1", reason: null },
      ownerUserId: "owner-1",
    });

    expect(result.unstar.success).toBe(true);
    expect(result.trash).toEqual({ attempted: true, reason: "completed", success: true });
    expect(unstarGmailThread).toHaveBeenCalledOnce();
    expect(trashGmailThread).toHaveBeenCalledOnce();
  });

  it("still Gmail-trashes when the independent unstar step fails", async () => {
    unstarGmailThread.mockRejectedValueOnce(new Error("network unavailable"));

    const result = await syncGmailPlayLifecycle({
      action: "trash",
      apiThreadId: "api-thread-1",
      context: { accountResolved: true, googleAccountId: "account-1", reason: null },
      ownerUserId: "owner-1",
    });

    expect(result.unstar).toEqual({
      attempted: true,
      reason: "gmail_unstar_failed",
      success: false,
    });
    expect(result.trash).toEqual({ attempted: true, reason: "completed", success: true });
    expect(trashGmailThread).toHaveBeenCalledOnce();
  });

  it("reports API thread absence without attempting Gmail", async () => {
    const result = await syncGmailPlayLifecycle({
      action: "trash",
      apiThreadId: null,
      context: { accountResolved: false, googleAccountId: null, reason: "api_thread_missing" },
      ownerUserId: "owner-1",
    });

    expect(result.unstar).toEqual({
      attempted: false,
      reason: "api_thread_missing",
      success: false,
    });
    expect(result.trash).toEqual(result.unstar);
    expect(unstarGmailThread).not.toHaveBeenCalled();
    expect(trashGmailThread).not.toHaveBeenCalled();
  });

  it("restores and stars a manually linked Gmail API thread", async () => {
    await expect(restoreGmailThreadForManualLink({
      apiThreadId: "api-thread-1",
      context: { accountResolved: true, googleAccountId: "account-1", reason: null },
      ownerUserId: "owner-1",
    })).resolves.toEqual({
      accountResolved: true,
      star: { attempted: true, reason: "completed", success: true },
      untrash: { attempted: true, reason: "completed", success: true },
    });
    expect(untrashGmailThread).toHaveBeenCalledWith({
      accessToken: "access-token",
      threadId: "api-thread-1",
    });
    expect(starGmailThread).toHaveBeenCalledWith({
      accessToken: "access-token",
      threadId: "api-thread-1",
    });
  });
});
