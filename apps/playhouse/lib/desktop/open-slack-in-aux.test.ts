import { describe, expect, it, vi } from "vitest";

import { openSlackInAux } from "./open-slack-in-aux";

describe("openSlackInAux", () => {
  it("routes the unchanged Slack URL through the shared Aux route", async () => {
    const route = vi.fn(async () => true);
    await expect(openSlackInAux("https://acme.slack.com/archives/C1", route))
      .resolves.toBe(true);
    expect(route).toHaveBeenCalledWith("https://acme.slack.com/archives/C1");
  });
});
