import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync(new URL("../app/plays/actions.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("./playhouse-shell.tsx", import.meta.url), "utf8");

describe("Done and Trash drag restoration", () => {
  it("reuses normal drop handlers while preserving the source lifecycle view", () => {
    expect(shell).toContain("sourceLifecycle: lifecycle");
    expect(shell).toContain('keepInCurrentView: lifecycle === "active" && isCurrentPlacement(placement)');
    expect(shell).toContain('persistMove(reorderPlacement, lifecycle === "active" ? play.id : null)');
  });

  it("removes restored rows optimistically only from inactive lifecycle views", () => {
    expect(shell).toContain('if (lifecycle !== "active")');
    expect(shell).toContain("nextPlays.filter((play) => !playIds.includes(play.id))");
  });

  it("persists the final destination before best-effort server-side Gmail restoration", () => {
    const revivalAction = actions.slice(
      actions.indexOf("async function restoreGmailAfterExplicitRevival"),
      actions.indexOf("async function savePlayInternal"),
    );
    expect(actions).toMatch(
      /const moved = await repository\.reposition[\s\S]*?await restoreGmailAfterExplicitRevival\(\{/,
    );
    expect(revivalAction).toContain("starGmailThreadForPlayRevival({");
    expect(actions).toContain("Play restored, but Gmail could not be starred.");
    expect(revivalAction).not.toContain("restoreGmailThreadForManualLink(");
  });
});
