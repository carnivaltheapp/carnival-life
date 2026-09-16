import { describe, expect, it, vi } from "vitest";

import { routeAndHandleIncomingGmail } from "./incoming-gmail-action";

describe("incoming Gmail indicator action", () => {
  it("handles events only after the existing Aux route succeeds", async () => {
    const route = vi.fn().mockResolvedValue(true);
    const handle = vi.fn().mockResolvedValue({ success: true });
    await expect(routeAndHandleIncomingGmail({
      handle,
      playId: "play-1",
      route,
      url: "https://mail.google.com/mail/u/0/#all/thread",
    })).resolves.toEqual({ handled: true, routed: true });
    expect(route.mock.invocationCallOrder[0]).toBeLessThan(handle.mock.invocationCallOrder[0]);
  });

  it("keeps the event unhandled when Aux routing fails", async () => {
    const handle = vi.fn().mockResolvedValue({ success: true });
    await expect(routeAndHandleIncomingGmail({
      handle,
      playId: "play-1",
      route: vi.fn().mockResolvedValue(false),
      url: "https://mail.google.com/mail/u/0/#all/thread",
    })).resolves.toEqual({ handled: false, routed: false });
    expect(handle).not.toHaveBeenCalled();
  });
});
