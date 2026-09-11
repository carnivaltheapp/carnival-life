import { CarnivalWorkspaceController, validWorkArea } from "./workspace-controller.js";

const NATIVE_HOST = "com.carnival.workspace";
const NATIVE_HOST_VERSION = "DRAWER-HOST-2";
const RECONNECT_ALARM = "carnival-native-host-reconnect";
const controller = new CarnivalWorkspaceController(chrome);
let nativePort = null;

function reportDrawerState(state) {
  if (!nativePort) return;
  if (state?.drawerState !== "open" || !validWorkArea(state.workArea)) {
    nativePort.postMessage({ state: "retracted", type: "workspaceState" });
    return;
  }
  nativePort.postMessage({
    contextRight: state.contextBounds.left + state.contextBounds.width,
    monitorBottom: state.workArea.top + state.workArea.height,
    monitorRight: state.workArea.left + state.workArea.width,
    monitorTop: state.workArea.top,
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

async function summonFromMessage(message) {
  if (message?.type === "summon" && validWorkArea(message.workArea)) {
    reportDrawerState(await controller.summon(message.workArea, message.monitorId ?? null));
  } else if (message?.type === "retract") {
    reportDrawerState(await controller.retract());
  }
}

function connectNativeHost() {
  if (nativePort) return;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort = port;
    port.onMessage.addListener((message) => {
      if (message?.type === "hostReady") {
        if (message.version === NATIVE_HOST_VERSION) {
          console.info(`Carnival native host: ${NATIVE_HOST_VERSION}`);
        } else {
          console.warn("Carnival native host version mismatch", message.version ?? "unknown");
        }
        return;
      }
      summonFromMessage(message).catch((error) => console.error("Carnival summon failed", error));
    });
    port.onDisconnect.addListener(() => {
      nativePort = null;
      chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: 1 });
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
  if (name === RECONNECT_ALARM) connectNativeHost();
});
chrome.action.onClicked.addListener(async () => {
  const display = await currentWorkArea();
  reportDrawerState(await controller.summon(display.workArea, display.monitorId));
});
chrome.windows.onBoundsChanged.addListener((window) => {
  controller.rememberBounds(window)
    .then((state) => {
      if (state) reportDrawerState(state);
    })
    .catch((error) => console.error("Carnival layout save failed", error));
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
