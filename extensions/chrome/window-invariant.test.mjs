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

test("PlayHouse tab-session events flush before the shared workspace debounce", () => {
  const background = readFileSync(new URL("./background.js", import.meta.url), "utf8");

  assert.match(background, /const PH_TAB_SAVE_DELAY_MS = 0;/);
  assert.match(
    background,
    /windowId === trackedPlayhouseWindowId \? PH_TAB_SAVE_DELAY_MS : TAB_SAVE_DELAY_MS/,
  );
  assert.match(background, /controller\.rememberWorkspaceTabs\(windowId, saveReason\)/);
});

test("PH tab diagnostics use the existing persistent extension ring", () => {
  const background = readFileSync(new URL("./background.js", import.meta.url), "utf8");

  assert.match(background, /createPhSessionDiagnosticTrail/);
  assert.match(background, /recordDiagnostic\("info", event, details\)/);
  assert.match(background, /phSessionDiagnostics,/);
  assert.match(background, /carnivalWorkspaceDiagnostics/);
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

test("native rollout prepares the existing pair before its first movement without topmost state", () => {
  const nativeHost = readFileSync(
    new URL("../../desktop/workspace/windows/CarnivalWorkspaceHost.cs", import.meta.url),
    "utf8",
  );
  const animationStart = nativeHost.indexOf("private static bool AnimateChromeWindows");
  const animationEnd = nativeHost.indexOf("private static WindowBounds AnchoredVisiblePlayhouse", animationStart);
  const animation = nativeHost.slice(animationStart, animationEnd);

  assert.ok(animation.indexOf("ActivateWorkspace(playhouse, context)") >= 0);
  assert.ok(animation.indexOf("ActivateWorkspace(playhouse, context)") < animation.indexOf("MovePair(playhouse"));
  assert.match(animation, /MovePair\(playhouse, Interpolate\(playhouseCurrent, playhouseTo, eased\)/);
  assert.doesNotMatch(animation, /HwndTopMost|TopMost|TOPMOST/);
  assert.match(animation, /opening complete but foreground activation failed/);
});

test("right-surface threshold ownership uses an acknowledged native handoff", () => {
  const controller = readFileSync(new URL("./workspace-controller.js", import.meta.url), "utf8");
  const background = readFileSync(new URL("./background.js", import.meta.url), "utf8");
  const nativeHost = readFileSync(
    new URL("../../desktop/workspace/windows/CarnivalWorkspaceHost.cs", import.meta.url),
    "utf8",
  );

  const transfer = controller.slice(
    controller.indexOf("const swapsPhysicalOwner"),
    controller.indexOf("if (target.restore)"),
  );
  assert.ok(transfer.indexOf("nativeTransferRightSurfaceOwner") < transfer.indexOf("this.save(nextState)"));
  assert.ok(transfer.indexOf("this.save(nextState)") < transfer.indexOf("state: \"minimized\""));
  assert.match(background, /type: "transferRightSurfaceOwner"/);
  assert.match(background, /message\?\.type === "rightSurfaceOwnerTransferred"/);
  assert.match(nativeHost, /contextHandle = incoming;/);
  assert.match(nativeHost, /contextOwnerVersion \+= 1;/);
  assert.match(nativeHost, /currentContextOwnerVersion != contextOwnerVersion/);
});
