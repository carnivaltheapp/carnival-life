import { CarnivalWorkspaceController, validWorkArea } from "./workspace-controller.js";
import { createWorkspaceActions } from "./workspace-summon.js";
import { isOpenInAuxMessage, routeOpenInAuxMessage } from "./aux-routing.js";

const NATIVE_HOST = "com.carnival.workspace";
const NATIVE_HOST_VERSION = "DRAWER-HOST-7";
const RECONNECT_ALARM = "carnival-native-host-reconnect";
const GEOMETRY_SAVE_DELAY_MS = 350;
const GMAIL_DRAG_TTL_MS = 10_000;
const TAB_SAVE_DELAY_MS = 300;
const DIAGNOSTIC_STORAGE_KEY = "carnivalWorkspaceDiagnostics";
const DIAGNOSTIC_LIMIT = 500;
let nativePort = null;
let nativeAnimationAvailable = false;
let nativeAnimationRequestId = 0;
let immediateNativeReconnectUsed = false;
const nativeAnimationRequests = new Map();
let geometrySaveTimer = null;
let pendingGmailDrag = null;
const tabSaveTimers = new Map();
const tabSaveReasons = new Map();
let diagnosticWriteQueue = Promise.resolve();

function recordDiagnostic(level, event, details = null) {
  console[level]?.(event, details ?? "");
  const entry = {
    component: "chrome-extension",
    details,
    event,
    level,
    timestamp: new Date().toISOString(),
  };
  diagnosticWriteQueue = diagnosticWriteQueue.then(async () => {
    const stored = await chrome.storage.local.get(DIAGNOSTIC_STORAGE_KEY);
    const entries = Array.isArray(stored[DIAGNOSTIC_STORAGE_KEY])
      ? stored[DIAGNOSTIC_STORAGE_KEY]
      : [];
    await chrome.storage.local.set({
      [DIAGNOSTIC_STORAGE_KEY]: [...entries, entry].slice(-DIAGNOSTIC_LIMIT),
    });
  }).catch((error) => console.error("Carnival diagnostic persistence failed", error));
}

const diagnosticLogger = {
  info(event, details) { recordDiagnostic("info", event, details); },
  warn(event, details) { recordDiagnostic("warn", event, details); },
};

function scheduleTabSave(windowId, reason) {
  if (!Number.isInteger(windowId)) return;
  if (controller.isRestoreInProgress(windowId)) {
    controller.logRestoreSaveSkipped(windowId, reason);
    return;
  }
  tabSaveReasons.set(windowId, reason);
  clearTimeout(tabSaveTimers.get(windowId));
  tabSaveTimers.set(windowId, setTimeout(() => {
    tabSaveTimers.delete(windowId);
    const saveReason = tabSaveReasons.get(windowId) ?? "tab-event";
    tabSaveReasons.delete(windowId);
    controller.rememberWorkspaceTabs(windowId, saveReason)
      .catch((error) => console.error("Carnival tab persistence failed", error));
  }, TAB_SAVE_DELAY_MS));
}

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
  logger: diagnosticLogger,
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
chrome.windows.onBoundsChanged.addListener((window) => {
  if (controller.isSystemGeometryChange(window.id)) {
    controller.logSystemGeometrySaveSkipped(window.id);
    return;
  }
  clearTimeout(geometrySaveTimer);
  geometrySaveTimer = setTimeout(async () => {
    geometrySaveTimer = null;
    try {
      const state = await controller.rememberVisibleBounds(window.id);
      if (state) reportDrawerState(state);
    } catch (error) {
      console.error("Carnival layout save failed", error);
    }
  }, GEOMETRY_SAVE_DELAY_MS);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.pinned !== undefined || changeInfo.status === "complete") {
    const reason = changeInfo.url
      ? "tab-url-updated"
      : changeInfo.pinned !== undefined ? "tab-pin-updated" : "tab-load-complete";
    scheduleTabSave(tab.windowId, reason);
  }
  if (changeInfo.status === "complete" && tab.url?.startsWith("https://mail.google.com/")) {
    chrome.tabs.sendMessage(tabId, { type: "gmailBridgePing" })
      .then((response) => {
        if (!response?.active) {
          diagnosticLogger.warn("GMAIL_CONTENT_SCRIPT_NOT_ACTIVE", {
            reason: "invalid-ping-response",
            tabId,
          });
        }
      })
      .catch(() => diagnosticLogger.warn("GMAIL_CONTENT_SCRIPT_NOT_ACTIVE", {
        reason: "content-script-ping-failed",
        tabId,
      }));
  }
});
chrome.tabs.onCreated.addListener((tab) => scheduleTabSave(tab.windowId, "tab-created"));
chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) {
    controller.logClosingTabSaveSkipped(removeInfo.windowId)
      .catch((error) => console.error("Carnival closing-tab diagnostic failed", error));
  } else {
    scheduleTabSave(removeInfo.windowId, "tab-removed");
  }
});
chrome.tabs.onActivated.addListener(({ windowId }) => scheduleTabSave(windowId, "tab-activated"));
chrome.tabs.onMoved.addListener((_tabId, moveInfo) => scheduleTabSave(moveInfo.windowId, "tab-moved"));
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message?.type === "recordGmailDiagnostic" &&
    typeof message.event === "string" &&
    message.event.startsWith("GMAIL_") &&
    message.event.length <= 100
  ) {
    recordDiagnostic(message.level === "warn" ? "warn" : "info", message.event, {
      ...(message.details && typeof message.details === "object" ? message.details : {}),
      frameId: Number.isInteger(_sender.frameId) ? _sender.frameId : null,
      tabId: Number.isInteger(_sender.tab?.id) ? _sender.tab.id : null,
    });
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "gmailDragStarted") {
    const attachment = message.attachment;
    if (
      typeof message.correlationId === "string" &&
      typeof attachment?.canonicalUrl === "string" &&
      typeof attachment?.threadRef === "string" &&
      Number.isSafeInteger(attachment?.accountIndex)
    ) {
      pendingGmailDrag = {
        actionId: typeof message.actionId === "string" ? message.actionId : message.correlationId,
        attachment,
        correlationId: message.correlationId,
        startedAt: Date.now(),
      };
      diagnosticLogger.info("GMAIL_PENDING_DRAG_STORED", {
        actionId: pendingGmailDrag.actionId,
        correlationId: pendingGmailDrag.correlationId,
        gmailAccountIndex: attachment.accountIndex,
        gmailThreadRef: attachment.threadRef,
      });
    } else {
      diagnosticLogger.warn("GMAIL_PENDING_DRAG_MISSING", {
        reason: "invalid-drag-payload",
      });
    }
    sendResponse({ ok: Boolean(pendingGmailDrag) });
    return false;
  }
  if (message?.type === "getPendingGmailDrag") {
    if (pendingGmailDrag && Date.now() - pendingGmailDrag.startedAt <= GMAIL_DRAG_TTL_MS) {
      const response = pendingGmailDrag;
      pendingGmailDrag = null;
      diagnosticLogger.info("GMAIL_PENDING_DRAG_USED", {
        actionId: response.actionId,
        correlationId: response.correlationId,
        gmailThreadRef: response.attachment.threadRef,
      });
      sendResponse(response);
    } else {
      pendingGmailDrag = null;
      diagnosticLogger.warn("GMAIL_PENDING_DRAG_MISSING", { reason: "missing-or-expired" });
      sendResponse({ attachment: null });
    }
    return false;
  }
  if (!isOpenInAuxMessage(message)) return false;
  routeOpenInAuxMessage({ controller, currentWorkArea, message, reportDrawerState })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ error: error.message, ok: false }));
  return true;
});

connectNativeHost();
