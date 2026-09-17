import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("./browser-time-zone.tsx", import.meta.url), "utf8");
const action = readFileSync(new URL("../app/time-zone/actions.ts", import.meta.url), "utf8");

describe("browser timezone profile synchronization", () => {
  it("persists a validated browser timezone when the profile differs", () => {
    expect(component).toContain("profileTimeZone !== timeZone");
    expect(component).toContain("saveBrowserTimeZone(timeZone)");
    expect(action).toContain("isSupportedTimeZone(timeZone)");
    expect(action).toContain("update({ timezone: timeZone })");
    expect(action).toContain('.eq("id", userId)');
  });
});
