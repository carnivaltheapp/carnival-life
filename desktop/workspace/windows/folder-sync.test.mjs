import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./CarnivalWorkspaceHost.cs", import.meta.url), "utf8");

test("folder sync scans folders only and watches directory names", () => {
  assert.match(source, /new FileSystemWatcher\(BranchRoot\)/);
  assert.match(source, /NotifyFilter = NotifyFilters\.DirectoryName/);
  assert.match(source, /watcher\.Created/);
  assert.match(source, /watcher\.Deleted/);
  assert.match(source, /watcher\.Renamed/);
  assert.doesNotMatch(source, /File\.GetFiles\(BranchRoot/);
});

test("folder paths are constrained beneath the canonical root", () => {
  assert.match(source, /candidate\.StartsWith\(root \+ "\\\\", StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(source, /throw new UnauthorizedAccessException/);
  assert.match(source, /Replace\('\\\\', '\/'\)/);
});

test("offline operations are durable and replayed idempotently", () => {
  assert.match(source, /PendingOperationDirectory/);
  assert.match(source, /Guid\.NewGuid\(\)\.ToString\("N"\)/);
  assert.match(source, /FlushPendingOperations/);
  assert.match(source, /File\.Delete\(file\)/);
});
