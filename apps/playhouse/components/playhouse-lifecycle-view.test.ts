import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync(new URL("./playhouse-shell.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const viewModel = readFileSync(new URL("../domain/playhouse-view.ts", import.meta.url), "utf8");

describe("PlayHouse scoped lifecycle controls", () => {
  it("uses the grid-header Done and Trash icons as scoped lifecycle toggles", () => {
    expect(shell).toContain('className="playGridLifecycleLink"');
    expect(shell).toContain('lifecycle: lifecycle === "done" ? "active" : "done"');
    expect(shell).toContain('lifecycle: lifecycle === "trash" ? "active" : "trash"');
    expect(shell).toContain('data-active={lifecycle === "done" || undefined}');
    expect(shell).toContain('data-active={lifecycle === "trash" || undefined}');
  });

  it("loads lifecycle separately from scope and does not remount away client Branch state", () => {
    expect(page).toContain("lifecycle={pageState.lifecycle}");
    expect(shell).toContain("key={selectedViewIdentity(props.selectedView)}");
    expect(shell).not.toContain("key={`${selectedViewIdentity(props.selectedView)}:${props.lifecycle}`}");
  });

  it("keeps client lifecycle navigation isolated from server-only repository code", () => {
    expect(shell).toContain('from "../domain/playhouse-view"');
    expect(shell).not.toContain('from "../lib/playhouse/data"');
    expect(viewModel).not.toContain("mongo-client");
    expect(viewModel).not.toContain("play-repository");
  });
});
