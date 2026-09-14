import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const playForm = readFileSync(new URL("./play-form.tsx", import.meta.url), "utf8");

describe("Play detail lifecycle actions", () => {
  it("reuses the established Done and Trash server actions", () => {
    expect(playForm).toContain("markPlayDone, savePlay, trashPlay");
    expect(playForm).toContain("markPlayDone,");
    expect(playForm).toContain("trashPlay,");
    expect(playForm).toMatch(/<form action=\{doneAction\}>[\s\S]*?✓ Done[\s\S]*?<\/form>/);
    expect(playForm).toMatch(/<form action=\{trashAction\}>[\s\S]*?Trash[\s\S]*?<\/form>/);
  });

  it("closes and refreshes after either successful action, then preserves Gmail sync", () => {
    expect(playForm).toMatch(/trashState\.status !== "success"[\s\S]*?requestGmailThreadUnstar\(play, "trash"\);[\s\S]*?removeAttribute\("open"\);[\s\S]*?router\.refresh\(\)/);
    expect(playForm).toMatch(/doneState\.status !== "success"[\s\S]*?requestGmailThreadUnstar\(play, "done"\);[\s\S]*?removeAttribute\("open"\);[\s\S]*?router\.refresh\(\)/);
  });

  it("keeps lifecycle forms outside the edit form so drafts are not submitted", () => {
    const mainFormEnd = playForm.indexOf("</form>", playForm.indexOf('id={formId}'));
    expect(mainFormEnd).toBeGreaterThan(0);
    expect(playForm.indexOf("<form action={doneAction}>")).toBeGreaterThan(mainFormEnd);
    expect(playForm.indexOf("<form action={trashAction}>")).toBeGreaterThan(mainFormEnd);
    expect(playForm.match(/<form action=\{doneAction\}>[\s\S]*?<\/form>/)?.[0]).not.toContain("formAction");
    expect(playForm.match(/<form action=\{trashAction\}>[\s\S]*?<\/form>/)?.[0]).not.toContain("formAction");
  });
});
