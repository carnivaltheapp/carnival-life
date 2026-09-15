import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const extensionDirectory = new URL("./", import.meta.url);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".next" || entry.name === "node_modules") return [];
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.(?:js|ts|tsx)$/.test(entry.name) ? [url] : [];
  });
}

test("Chrome window mutations remain isolated in the managed workspace controller", () => {
  const forbidden = /chrome\.windows\.(?:create|remove|update)\s*\(/;
  const offenders = readdirSync(extensionDirectory)
    .filter((name) => name.endsWith(".js") && name !== "workspace-controller.js")
    .filter((name) => forbidden.test(readFileSync(new URL(name, extensionDirectory), "utf8")));

  assert.deepEqual(offenders, []);
});

test("PlayHouse feature code cannot directly manipulate Chrome windows", () => {
  const playhouseDirectory = new URL("../../apps/playhouse/", import.meta.url);
  const offenders = sourceFiles(playhouseDirectory).filter((file) => (
    /chrome\.windows\.(?:create|remove|update)\s*\(/.test(readFileSync(file, "utf8"))
  ));

  assert.deepEqual(offenders, []);
});

test("native foreground APIs remain isolated from resident companion work", () => {
  const source = readFileSync(
    new URL("../../desktop/workspace/windows/CarnivalWorkspaceHost.cs", import.meta.url),
    "utf8",
  );
  const residentStart = source.indexOf("private static void RunResident");
  const residentEnd = source.indexOf("private static void RunNativeMessagingBridge", residentStart);
  const residentSection = source.slice(residentStart, residentEnd);

  assert.ok(residentStart >= 0);
  assert.ok(residentEnd > residentStart);
  assert.doesNotMatch(
    residentSection,
    /(?:BringWindowToTop|SetForegroundWindow|SetWindowPos|ShowWindowAsync)\s*\(/,
  );
});

test("PlayHouse resting geometry is anchored while Drawer animation may move the pair", () => {
  const controller = readFileSync(new URL("./workspace-controller.js", import.meta.url), "utf8");
  const background = readFileSync(new URL("./background.js", import.meta.url), "utf8");
  const nativeHost = readFileSync(
    new URL("../../desktop/workspace/windows/CarnivalWorkspaceHost.cs", import.meta.url),
    "utf8",
  );

  assert.match(controller, /canonicalRetractedWorkspaceLayout/);
  assert.match(controller, /playhouse:\s*shifted\(visibleLayout\.playhouse, -workArea\.width\)/);
  assert.match(controller, /getAnchoredPlayhouseGeometry\(workArea, layout\.playhouse\.width\)/);
  assert.match(controller, /playhouseBounds:\s*getAnchoredPlayhouseGeometry/);
  assert.match(background, /action: animation\.action/);
  assert.match(background, /workAreaLeft: animation\.workArea\.left/);
  assert.match(background, /workAreaTop: animation\.workArea\.top/);
  assert.match(nativeHost, /PH_VISIBLE_ANCHOR_INVARIANT_VIOLATION/);
  assert.match(nativeHost, /MovePair\(playhouse, Interpolate\(playhouseCurrent, playhouseTo, eased\)/);
  assert.doesNotMatch(nativeHost, /AnchoredVisiblePlayhouse\(\s*Interpolate/);
});
