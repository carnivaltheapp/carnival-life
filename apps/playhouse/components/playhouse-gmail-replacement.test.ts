import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync(new URL("./playhouse-shell.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const actions = readFileSync(new URL("../app/plays/actions.ts", import.meta.url), "utf8");

describe("manual Gmail replacement confirmation", () => {
  it("renders a PlayHouse confirmation with safe-default Cancel and explicit Replace", () => {
    expect(shell).toContain('role="dialog"');
    expect(shell).toContain("Replace Gmail conversation?");
    expect(shell).toContain("This Play is already linked to another Gmail conversation.");
    expect(shell).toMatch(/<button[\s\S]*?autoFocus[\s\S]*?>[\s\S]*?Cancel/);
    expect(shell).toMatch(/gmailReplacementConfirm[\s\S]*?confirmGmailReplacement[\s\S]*?Replace/);
    expect(shell).not.toContain("window.confirm");
  });

  it("keeps the prompt modal above ordinary PlayHouse UI", () => {
    expect(stylesheet).toMatch(
      /\.gmailReplacementBackdrop\s*\{[\s\S]*?z-index:\s*var\(--z-modal\)/,
    );
  });

  it("does not invoke the authorized replacement until Replace is selected", () => {
    expect(shell).toMatch(
      /result\.replacementConfirmation[\s\S]*?setGmailReplacementPrompt/,
    );
    expect(shell).toMatch(
      /confirmGmailReplacement[\s\S]*?manualLinkGmailToPlay\(prompt\.request, prompt\.authorization\)/,
    );
    expect(shell).toMatch(
      /gmailReplacementSubmittingRef\.current\) return;[\s\S]*?gmailReplacementSubmittingRef\.current = true/,
    );
    expect(shell).toMatch(
      /cancelGmailReplacement[\s\S]*?cancelManualGmailReplacement/,
    );
    const cancelAction = actions.slice(
      actions.indexOf("export async function cancelManualGmailReplacement"),
      actions.indexOf("export async function manualLinkGmailToPlay"),
    );
    expect(cancelAction).toContain("MANUAL_GMAIL_REPLACE_CANCELLED");
    expect(cancelAction).not.toContain("manualLinkGmail");
    expect(cancelAction).not.toContain("restoreGmailThreadForManualLink");
  });
});
