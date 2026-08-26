import { describe, expect, it, vi } from "vitest";

import { applySuccessfulPlaySave } from "./play-form-success";

describe("applySuccessfulPlaySave", () => {
  it("closes the form before refreshing the current route after success", () => {
    const calls: string[] = [];

    applySuccessfulPlaySave("success", {
      close: () => calls.push("close"),
      refresh: () => calls.push("refresh"),
    });

    expect(calls).toEqual(["close", "refresh"]);
  });

  it.each(["idle", "error"] as const)(
    "does not close or refresh for %s state",
    (status) => {
      const close = vi.fn();
      const refresh = vi.fn();

      applySuccessfulPlaySave(status, { close, refresh });

      expect(close).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    },
  );
});
