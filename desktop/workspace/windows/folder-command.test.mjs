import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const host = readFileSync(new URL("./CarnivalWorkspaceHost.cs", import.meta.url), "utf8");

test("resident polls authenticated folder commands and acknowledges verified creation", () => {
  assert.match(host, /CompanionRequest\("\/commands", "GET", credential, null\)/);
  assert.match(host, /Directory\.CreateDirectory\(target\)/);
  assert.match(host, /folder_already_exists/);
  assert.match(host, /CompletedCommandDirectory/);
  assert.match(host, /if \(!Directory\.Exists\(target\)\) throw new IOException\("folder_verification_failed"\)/);
  assert.match(host, /\/complete", "POST"/);
});

test("native validation constrains parents beneath Google Drive and rejects unsafe names", () => {
  assert.match(host, /RelativeFolderPath\(fullPath\)/);
  assert.match(host, /Path\.GetInvalidFileNameChars\(\)/);
  assert.match(host, /con\|prn\|aux\|nul/);
});

test("existing-folder Branch commands write the local marker before acknowledgement", () => {
  assert.match(host, /set_branch_state/);
  assert.match(host, /ExecuteBranchStateCommand/);
  assert.match(host, /WriteFolderInfoTip\(target, command\.IsBranch \? "branch=1" : ""\)/);
  assert.match(host, /CompleteFolderCommand\(command\.CommandId, credential, true, command\.RelativePath/);
});
