import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const playForm = readFileSync(new URL("./play-form.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("Play detail Cancel", () => {
  it("removes the open-state summary/X target and renders Cancel beside Save", () => {
    expect(stylesheet).toMatch(/\.editDisclosure\[open\] > summary\s*\{\s*display: none;/);
    expect(stylesheet).not.toContain('content: "×"');
    expect(playForm).toMatch(/className="secondaryButton"[\s\S]*type="button"[\s\S]*Cancel[\s\S]*Save changes/);
  });

  it("closes locally after resetting every controlled detail draft", () => {
    expect(playForm).toContain("event.preventDefault()");
    expect(playForm).toContain("event.stopPropagation()");
    expect(playForm).toContain("setPlacementKind(initialPlacement.kind)");
    expect(playForm).toContain('setReminderDate("")');
    expect(playForm).toContain("setSelectedPlayers(selectionsFromPlay(play))");
    expect(playForm).toContain("setFormResetVersion((version) => version + 1)");
    expect(playForm).toContain('detailsRef.current?.removeAttribute("open")');
    expect(playForm).toMatch(/key=\{formResetVersion\}[\s\S]*?noValidate/);
  });

  it("does not route or submit from the Cancel handler", () => {
    const handler = playForm.match(
      /function cancelEdit[\s\S]*?\n  \}\n\n  return \(/,
    )?.[0] ?? "";

    expect(handler).not.toContain("formAction");
    expect(handler).not.toContain("router");
    expect(handler).not.toContain("routePlayDescriptionAux");
    expect(handler).not.toContain("openInAuxAndWait");
  });
});
