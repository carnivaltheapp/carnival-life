import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync(new URL("../app/plays/actions.ts", import.meta.url), "utf8");
const assignee = readFileSync(
  new URL("../lib/google/gmail-assignee.server.ts", import.meta.url),
  "utf8",
);
const shell = readFileSync(new URL("./playhouse-shell.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

describe("Shift-created Gmail Play contact follow-up", () => {
  it("keeps the existing exact-contact assignment in the creation transaction", () => {
    const create = sourceBetween(
      actions,
      "export async function createGmailPlayFromRow",
      "export async function addGmailCounterpartyContact",
    );
    expect(create).toMatch(
      /resolution\.status === "matched"[\s\S]*?playerContactId = resolution\.contact\.id/,
    );
    expect(create).toContain("playerDisplayName = resolution.contact.displayName");
    expect(create).toMatch(
      /repository\.createGmail\([\s\S]*?input: \{ \.\.\.input, playerContactId \}[\s\S]*?playerDisplayName/,
    );
  });

  it("offers Add Contact or Not Now only after a missing-contact Play succeeds", () => {
    expect(actions).toMatch(
      /resolution\.status === "contact_not_found"[\s\S]*?contactPrompt = resolution\.counterparty/,
    );
    expect(shell).toContain("Add Contact?");
    expect(shell).toContain("Add Contact");
    expect(shell).toContain("Not Now");
    expect(shell).toMatch(
      /result\.status !== "success" \|\| !result\.playId[\s\S]*?result\.contactPrompt[\s\S]*?setGmailContactPrompt/,
    );
  });

  it("creates through Google People and assigns the canonical Player reference", () => {
    expect(assignee).toMatch(
      /createPersonForAccount\([\s\S]*?upsertSelectedContactReference/,
    );
    const add = sourceBetween(
      actions,
      "export async function addGmailCounterpartyContact",
      "export async function unlinkGmailFromPlay",
    );
    expect(add).toMatch(
      /createGmailAssigneeForParticipants\([\s\S]*?repository\.assignPlayer\(/,
    );
    expect(add).toContain("playerContactId: resolution.contact.id");
    expect(add).toContain("playerDisplayName: resolution.contact.displayName");
    expect(add).toContain("playerResourceName: resolution.contact.providerResourceName");
    expect(add).toContain('(source === "supabase" && !isUuid(request.playId))');
    expect(shell).toMatch(
      /result\.status !== "success"[\s\S]*?setGmailContactPrompt\(null\)[\s\S]*?setMoveError[\s\S]*?return[\s\S]*?setGmailContactPrompt\(null\)[\s\S]*?const updatedPlay = result\.play/,
    );
  });

  it("makes Not Now a local dismissal that leaves the linked Play and Player untouched", () => {
    const dismiss = sourceBetween(
      shell,
      "const dismissGmailContactPrompt",
      "function addGmailContact",
    );
    expect(dismiss).toContain("setGmailContactPrompt(null)");
    expect(dismiss).not.toMatch(/createGmail|assignPlayer|unlink|repository/);
  });

  it("keeps contact failure separate from the already committed Play creation", () => {
    const add = sourceBetween(
      actions,
      "export async function addGmailCounterpartyContact",
      "export async function unlinkGmailFromPlay",
    );
    expect(add).toContain("The Play was still created.");
    expect(add).not.toMatch(/repository\.(?:delete|trash|createGmail)/);
    expect(shell).toMatch(
      /const result = await addGmailCounterpartyContact[\s\S]*?result\.status !== "success"[\s\S]*?setGmailContactPrompt\(null\)[\s\S]*?setMoveError\(result\.message\)[\s\S]*?return/,
    );
    expect(shell).toMatch(
      /catch \{[\s\S]*?setGmailContactPrompt\(null\)[\s\S]*?The Gmail contact could not be added\. The Play was still created\./,
    );
  });

  it("shows Create Play only for Shift-create hover and retains the normal label", () => {
    expect(shell).toContain('setGmailDropIntent(event.shiftKey ? "create_new" : "link_existing")');
    expect(shell).toContain("data-gmail-drop-intent=");
    expect(stylesheet).toMatch(
      /\.playRow\[data-gmail-drop-target="true"\]::after[\s\S]*?content:\s*"Link Gmail"/,
    );
    expect(stylesheet).toMatch(
      /data-gmail-drop-intent="create_new"[\s\S]*?content:\s*"Create Play"/,
    );
  });
});
