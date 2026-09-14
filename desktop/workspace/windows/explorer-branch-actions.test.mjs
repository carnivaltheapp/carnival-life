import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const host = readFileSync(new URL("./CarnivalWorkspaceHost.cs", import.meta.url), "utf8");
const installer = readFileSync(new URL("./install.ps1", import.meta.url), "utf8");
const uninstaller = readFileSync(new URL("./uninstall.ps1", import.meta.url), "utf8");

test("Explorer actions are scoped to Google Drive and invoke explicit Branch commands", () => {
  assert.match(installer, /System\.ItemPathDisplay:~="C:\\Google Drive\\"/);
  assert.match(installer, /CarnivalAddBranch/);
  assert.match(installer, /CarnivalRemoveBranch/);
  assert.match(host, /--add-branch/);
  assert.match(host, /--remove-branch/);
});

test("Branch changes update the local marker and use the durable authenticated queue", () => {
  assert.match(host, /WriteFolderInfoTip\(folderPath, isBranch \? "branch=1" : ""\)/);
  assert.match(host, /SendOrQueueOperation\("\/branch-state"/);
  assert.match(host, /PersistPendingOperation/);
});

test("uninstall removes only registered companion integration and its bounded data directory", () => {
  assert.match(uninstaller, /CarnivalAddBranch/);
  assert.match(uninstaller, /CarnivalRemoveBranch/);
  assert.match(uninstaller, /\$resolvedInstallDirectory\.StartsWith\(\$resolvedLocalAppData/);
});
