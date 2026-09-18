import { describe, expect, it, vi } from "vitest";

import { applyPlayLifecycle, type GmailLifecycleCleanupResult } from "./gmail-lifecycle";

const completed: GmailLifecycleCleanupResult = {
  accountResolved: true,
  trash: null,
  unstar: { attempted: true, reason: "completed", success: true },
};

describe("authoritative Play lifecycle", () => {
  it("persists Mongo before Gmail cleanup", async () => {
    const order: string[] = [];
    const result = await applyPlayLifecycle({
      gmailLinked: true,
      persist: vi.fn(async () => {
        order.push("mongo");
        return true;
      }),
      syncGmail: vi.fn(async () => {
        order.push("gmail");
        return completed;
      }),
    });

    expect(result).toEqual({ cleanup: completed, persisted: true });
    expect(order).toEqual(["mongo", "gmail"]);
  });

  it("keeps Mongo persisted when Gmail cleanup fails", async () => {
    const failure: GmailLifecycleCleanupResult = {
      accountResolved: true,
      trash: { attempted: true, reason: "gmail_trash_failed", success: false },
      unstar: { attempted: true, reason: "gmail_unstar_failed", success: false },
    };
    const persist = vi.fn().mockResolvedValue(true);

    await expect(applyPlayLifecycle({
      gmailLinked: true,
      persist,
      syncGmail: vi.fn().mockResolvedValue(failure),
    })).resolves.toEqual({ cleanup: failure, persisted: true });
    expect(persist).toHaveBeenCalledOnce();
  });

  it("does not contact Gmail when Mongo persistence fails", async () => {
    const syncGmail = vi.fn();
    await expect(applyPlayLifecycle({
      gmailLinked: true,
      persist: vi.fn().mockResolvedValue(false),
      syncGmail,
    })).resolves.toEqual({ persisted: false });
    expect(syncGmail).not.toHaveBeenCalled();
  });

  it("keeps non-Gmail lifecycle changes Mongo-only", async () => {
    const syncGmail = vi.fn();
    await expect(applyPlayLifecycle({
      gmailLinked: false,
      persist: vi.fn().mockResolvedValue(true),
      syncGmail,
    })).resolves.toEqual({ persisted: true });
    expect(syncGmail).not.toHaveBeenCalled();
  });
});
