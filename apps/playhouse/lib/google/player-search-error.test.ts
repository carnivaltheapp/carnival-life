import { describe, expect, it } from "vitest";

import { playerSearchErrorMessage } from "./player-search-error";
import { GoogleAccountReconnectRequiredError } from "./token-broker";

describe("Player search errors", () => {
  it("gives a useful reconnect response for revoked Google authorization", () => {
    expect(
      playerSearchErrorMessage(new GoogleAccountReconnectRequiredError()),
    ).toContain("reconnected");
  });

  it("does not expose unexpected provider error details", () => {
    expect(playerSearchErrorMessage(new Error("sensitive response"))).toBe(
      "Players could not be searched right now. Please try again.",
    );
  });
});
