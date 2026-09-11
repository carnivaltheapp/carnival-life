import { CarnivalWorkspaceController, validWorkArea } from "./workspace-controller.js";
import { createWorkspaceActions } from "./workspace-summon.js";

const NATIVE_HOST = "com.carnival.workspace";
const NATIVE_HOST_VERSION = "DRAWER-HOST-7";
const RECONNECT_ALARM = "carnival-native-host-reconnect";
const GEOMETRY_SAVE_DELAY_MS = 350;
let nativePort = null;
let nativeAnimationAvailable = false;
let nativeAnimationRequestId = 0;
let immediateNativeReconnectUsed = false;
const nativeAnimationRequests = new Map();
let geometrySaveTimer = null;

function flattenBounds(prefix, bounds) {
  return {
    [`${prefix}Height`]: bounds.height,
    [`${prefix}Left`]: bounds.left,
    [`${prefix}Top`]: bounds.top,
    [`${prefix}Width`]: bounds.width,
  };
}

async function animateWindowsNatively(animation) {
  if (!nativePort || !nativeAnimationAvailable) return false;
  const requestId = ++nativeAnimationRequestId;
  console.info(`Carnival: sending native ${animation.easing === "out" ? "open" : "retract"} animation`);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      nativeAnimationRequests.delete(requestId);
      console.warn("Carnival: native animation timed out; using extension fallback");
      resolve(false);
    }, 1500);
    nativeAnimationRequests.set(requestId, (ok) => {
      clearTimeout(timeout);
      console.info(`Carnival: native animation ${ok ? "complete" : "rejected"}`);
      resolve(ok);
    });
    try {
      nativePort.postMessage({
        ...flattenBounds("contextCurrent", animation.context.current),
        ...flattenBounds("contextFrom", animation.context.from),
        ...flattenBounds("contextTo", animation.context.to),
        durationMs: animation.durationMs,
        easing: animation.easing,
        ...flattenBounds("playhouseCurrent", animation.playhouse.current),
        ...flattenBounds("playhouseFrom", animation.playhouse.from),
        ...flattenBounds("playhouseTo", animation.playhouse.to),
        requestId,
        type: "animateWindows",
      });
    } catch (error) {
      clearTimeout(timeout);
      nativeAnimationRequests.delete(requestId);
      console.warn("Carnival: native animation request failed; using visible fallback", error);
      resolve(false);
    }
  });
}

async function activateWindowsNatively({ context, playhouse }) {
  if (!nativePort || !nativeAnimationAvailable) return false;
  try {
    nativePort.postMessage({
      ...flattenBounds("context", context),
      ...flattenBounds("playhouse", playhouse),
      type: "activateWindows",
    });
    return true;
  } catch (error) {
    console.warn("Carnival: native foreground activation failed", error);
    return false;
  }
}

const controller = new CarnivalWorkspaceController(chrome, {
  nativeActivate: activateWindowsNatively,
  nativeAnimate: animateWindowsNatively,
});

function reportDrawerState(state) {
  if (!nativePort) return;
  if (state?.drawerState !== "open" || !validWorkArea(state.workArea)) {
    nativePort.postMessage({ state: "retracted", type: "workspaceState" });
    return;
  }
  nativePort.postMessage({
    ...flattenBounds("context", state.contextBounds),
    contextRight: state.contextBounds.left + state.contextBounds.width,
    monitorBottom: state.workArea.top + state.workArea.height,
    monitorRight: state.workArea.left + state.workArea.width,
    monitorTop: state.workArea.top,
    ...flattenBounds("playhouse", state.playhouseBounds),
    state: "open",
    type: "workspaceState",
  });
}

async function currentWorkArea() {
  const displays = await chrome.system.display.getInfo();
  const focused = await chrome.windows.getLastFocused();
  const center = {
    x: (focused.left ?? 0) + Math.round((focused.width ?? 0) / 2),
    y: (focused.top ?? 0) + Math.round((focused.height ?? 0) / 2),
  };
  const display = displays.find(({ bounds }) => (
    center.x >= bounds.left && center.x < bounds.left + bounds.width &&
    center.y >= bounds.top && center.y < bounds.top + bounds.height
  )) ?? displays.find(({ isPrimary }) => isPrimary) ?? displays[0];
  if (!display || !validWorkArea(display.workArea)) {
    throw new Error("Chrome could not determine a usable display work area.");
  }
  return { monitorId: display.id, workArea: display.workArea };
}

const workspaceActions = createWorkspaceActions({
  controller,
  reportDrawerState,
  validWorkArea,
});

function connectNativeHost() {
  if (nativePort) return;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort = port;
    port.onMessage.addListener((message) => {
      console.info(`Carnival native message: ${message?.type ?? "unknown"}`);
      if (message?.type === "hostReady") {
        immediateNativeReconnectUsed = false;
        nativeAnimationAvailable = message.version === NATIVE_HOST_VERSION && message.nativeWindowAnimation === true;
        if (nativeAnimationAvailable) {
          console.info(`Carnival native host: ${NATIVE_HOST_VERSION}`);
        } else {
          console.warn("Carnival native host version mismatch", message.version ?? "unknown");
        }
        return;
      }
      if (message?.type === "animationComplete") {
        const complete = nativeAnimationRequests.get(message.requestId);
        nativeAnimationRequests.delete(message.requestId);
        complete?.(message.ok === true);
        return;
      }
      workspaceActions.handleNativeMessage(message, port)
        .catch((error) => console.error("Carnival summon failed", error));
    });
    port.onDisconnect.addListener(() => {
      const reconnectImmediately = !immediateNativeReconnectUsed;
      immediateNativeReconnectUsed = true;
      nativeAnimationAvailable = false;
      for (const complete of nativeAnimationRequests.values()) complete(false);
      nativeAnimationRequests.clear();
      nativePort = null;
      chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: 1 });
      if (reconnectImmediately) connectNativeHost();
    });
    controller.state().then(reportDrawerState).catch(() => {});
  } catch (error) {
    console.warn("Carnival native host is unavailable", error);
    chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: 1 });
  }
}

chrome.runtime.onInstalled.addListener(connectNativeHost);
chrome.runtime.onStartup.addListener(connectNativeHost);
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === RECONNECT_ALARM) {
    immediateNativeReconnectUsed = false;
    connectNativeHost();
  }
});
chrome.action.onClicked.addListener(async () => {
  const display = await currentWorkArea();
  await workspaceActions.summon(display, "toolbar");
});
chrome.windows.onCreated.addListener(connectNativeHost);
chrome.windows.onRemoved.addListener((windowId) => {
  controller.handleWindowClosed(windowId)
    .then((state) => {
      if (state) reportDrawerState(state);
    })
    .catch((error) => console.error("Carnival window-close reconciliation failed", error));
});
chrome.windows.onBoundsChanged.addListener(() => {
  clearTimeout(geometrySaveTimer);
  geometrySaveTimer = setTimeout(async () => {
    geometrySaveTimer = null;
    try {
      const state = await controller.rememberVisibleBounds();
      if (state) reportDrawerState(state);
    } catch (error) {
      console.error("Carnival layout save failed", error);
    }
  }, GEOMETRY_SAVE_DELAY_MS);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  controller.rememberContextTab(tabId, changeInfo, tab)
    .catch((error) => console.error("Carnival context save failed", error));
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "openCarnivalContext") return false;
  currentWorkArea()
    .then(({ monitorId, workArea }) => controller.openCarnivalContext(message.url, workArea, monitorId))
    .then(() => controller.state())
    .then(reportDrawerState)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ error: error.message, ok: false }));
  return true;
});

connectNativeHost();
