import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("incoming Gmail grid indicator", () => {
  it("renders only for unhandled event state beside Slack and stops row propagation", () => {
    const source = readFileSync(new URL("./play-status-actions.tsx", import.meta.url), "utf8");
    const slackIndex = source.indexOf("play.incomingGmailCount");
    expect(slackIndex).toBeGreaterThan(source.indexOf("slackUrl ?"));
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("New Gmail message");
    expect(source).toContain("IncomingGmailIcon");
  });
});
