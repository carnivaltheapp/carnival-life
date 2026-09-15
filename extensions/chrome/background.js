import { CarnivalWorkspaceController, validWorkArea } from "./workspace-controller.js";
import { createWorkspaceActions } from "./workspace-summon.js";
import { isOpenInAuxMessage, routeOpenInAuxMessage } from "./aux-routing.js";
import { createWindowTrace } from "./window-trace.js";
import {
  requestVisibleGmailMetadata,
  selectGmailMetadataTab,
  verifyVisibleGmailParticipants,
} from "./gmail-tab-metadata.js";

const NATIVE_HOST = "com.carnival.workspace";
const NATIVE_HOST_VERSION = "DRAWER-HOST-14";
const RECONNECT_ALARM = "carnival-native-host-reconnect";
const GEOMETRY_SAVE_DELAY_MS = 350;
const GET_GMAIL_THREAD_PARTICIPANTS = "getGmailThreadParticipants";
const STAR_GMAIL_THREAD = "starGmailThread";
const STAR_VISIBLE_GMAIL_THREAD = "starVisibleGmailThread";
const UNSTAR_GMAIL_THREAD = "unstarGmailThread";
const UNSTAR_VISIBLE_GMAIL_THREAD = "unstarVisibleGmailThread";
const TAB_SAVE_DELAY_MS = 300;
const DIAGNOSTIC_STORAGE_KEY = "carnivalWorkspaceDiagnostics";
const DIAGNOSTIC_LIMIT = 500;
const GET_LOCAL_BRANCHES = "getLocalBranches";
let nativePort = null;
let nativeAnimationAvailable = false;
let nativeAnimationRequestId = 0;
let immediateNativeReconnectUsed = false;
const nativeAnimationRequests = new Map();
const nativeBranchRequests = new Map();
let nativeBranchRequestId = 0;
let branchHierarchyCache = null;
let geometrySaveTimer = null;
const tabSaveTimers = new Map();
const tabSaveReasons = new Map();
let diagnosticWriteQueue = Promise.resolve();

function branchSummary(branches, durationMs) {
  const count = (nodes) => nodes.reduce(
    (total, branch) => total + (branch.selectable ? 1 : 0) + count(branch.children ?? []),
    0,
  );
  return { branchCount: count(branches), durationMs, topLevelCount: branches.length };
}

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

const windowTrace = createWindowTrace({
  chromeApi: chrome,
  getNativeState: () => ({
    animationAvailable: nativeAnimationAvailable,
    connected: Boolean(nativePort),
    hostVersion: NATIVE_HOST_VERSION,
  }),
});

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
  windowTrace,
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
  windowTrace,
});

function connectNativeHost() {
  if (nativePort) return;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort = port;
    port.onMessage.addListener((message) => {
      console.info(`Carnival native message: ${message?.type ?? "unknown"}`);
      windowTrace.emit("background", "NATIVE_HOST_MESSAGE", {
        messageType: message?.type ?? "unknown",
      });
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
      if (message?.type === "BRANCH_TREE_RESULT") {
        const request = nativeBranchRequests.get(message.requestId);
        nativeBranchRequests.delete(message.requestId);
        if (!request) return;
        if (message.ok === true && Array.isArray(message.branches)) {
          branchHierarchyCache = message.branches;
          const summary = branchSummary(branchHierarchyCache, Date.now() - request.startedAt);
          recordDiagnostic("info", "BRANCH_TREE_NATIVE_RESPONSE", summary);
          recordDiagnostic("info", "BRANCH_TREE_EXTENSION_RESPONSE", summary);
          request.complete({ ok: true, branches: branchHierarchyCache, summary });
        } else {
          recordDiagnostic("warn", "BRANCH_TREE_FAILED", { reason: "native_response_failed" });
          request.complete({ ok: false, branches: [] });
        }
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
      for (const request of nativeBranchRequests.values()) request.complete({ ok: false, branches: [] });
      nativeBranchRequests.clear();
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
chrome.windows.onCreated.addListener((window) => {
  windowTrace.chromeWindowCreated(window);
  connectNativeHost();
});
chrome.windows.onRemoved.addListener((windowId) => {
  windowTrace.chromeWindowRemoved(windowId);
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
  windowTrace.tabEvent("CHROME_TAB_ON_UPDATED", { ...tab, id: tabId }, changeInfo);
  if (changeInfo.url || changeInfo.pinned !== undefined || changeInfo.status === "complete") {
    const reason = changeInfo.url
      ? "tab-url-updated"
      : changeInfo.pinned !== undefined ? "tab-pin-updated" : "tab-load-complete";
    scheduleTabSave(tab.windowId, reason);
  }
});
chrome.tabs.onCreated.addListener((tab) => {
  windowTrace.tabEvent("CHROME_TAB_ON_CREATED", tab);
  scheduleTabSave(tab.windowId, "tab-created");
});
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
  if (message?.type === "carnivalBridgeHealth") {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === GET_LOCAL_BRANCHES) {
    recordDiagnostic("info", "BRANCH_TREE_EXTENSION_RECEIVED");
    if (branchHierarchyCache) {
      sendResponse({
        ok: true,
        branches: branchHierarchyCache,
        summary: branchSummary(branchHierarchyCache, 0),
      });
      return false;
    }
    if (!nativePort) {
      recordDiagnostic("warn", "BRANCH_TREE_FAILED", { reason: "native_host_unavailable" });
      sendResponse({ ok: false, branches: [] });
      return false;
    }
    const requestId = ++nativeBranchRequestId;
    const timeout = setTimeout(() => {
      nativeBranchRequests.delete(requestId);
      recordDiagnostic("warn", "BRANCH_TREE_FAILED", { reason: "native_response_timeout" });
      sendResponse({ ok: false, branches: [] });
    }, 15000);
    nativeBranchRequests.set(requestId, {
      complete(response) {
        clearTimeout(timeout);
        sendResponse(response);
      },
      startedAt: Date.now(),
    });
    try {
      recordDiagnostic("info", "BRANCH_TREE_NATIVE_REQUESTED");
      nativePort.postMessage({ requestId, type: "GET_BRANCH_TREE" });
    } catch {
      clearTimeout(timeout);
      nativeBranchRequests.delete(requestId);
      recordDiagnostic("warn", "BRANCH_TREE_FAILED", { reason: "native_request_failed" });
      sendResponse({ ok: false, branches: [] });
      return false;
    }
    return true;
  }
  if (message?.type === UNSTAR_GMAIL_THREAD) {
    const diagnostic = {
      action: message.action,
      playId: message.playId,
      threadRef: message.threadRef,
    };
    recordDiagnostic("info", "GMAIL_UNSTAR_STARTED", diagnostic);
    recordDiagnostic("info", "GMAIL_UNSTAR_TAB_LOOKUP", {
      ...diagnostic,
      accountIndex: message.accountIndex,
    });
    chrome.tabs.query({ url: "https://mail.google.com/*" }).then(async (tabs) => {
      const tab = selectGmailMetadataTab(tabs, message);
      if (!tab) {
        recordDiagnostic("warn", "GMAIL_UNSTAR_FAILED", {
          ...diagnostic,
          reason: "matching_tab_not_found",
        });
        sendResponse({ ok: false, reason: "matching_tab_not_found" });
        return;
      }
      const matched = { ...diagnostic, matchedTabId: tab.id };
      recordDiagnostic("info", "GMAIL_UNSTAR_TAB_MATCHED", matched);
      recordDiagnostic("info", "GMAIL_UNSTAR_COMMAND_SENT", matched);
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, {
          threadRef: message.threadRef,
          type: UNSTAR_VISIBLE_GMAIL_THREAD,
        });
      } catch {
        await chrome.scripting.executeScript({
          files: ["gmail-drag-bridge.js"],
          target: { tabId: tab.id },
        });
        recordDiagnostic("info", "GMAIL_UNSTAR_CONTENT_SCRIPT_RECOVERED", matched);
        response = await chrome.tabs.sendMessage(tab.id, {
          threadRef: message.threadRef,
          type: UNSTAR_VISIBLE_GMAIL_THREAD,
        });
      }
      if (!response?.ok) {
        recordDiagnostic("warn", "GMAIL_UNSTAR_FAILED", {
          ...diagnostic,
          reason: response?.reason ?? "unstar_failed",
        });
        sendResponse({ ok: false, reason: response?.reason ?? "unstar_failed" });
        return;
      }
      recordDiagnostic("info", "GMAIL_UNSTAR_UI_COMPLETE", matched);
      recordDiagnostic("info", "GMAIL_UNSTAR_COMPLETE", diagnostic);
      sendResponse({ ok: true });
    }).catch(() => {
      recordDiagnostic("warn", "GMAIL_UNSTAR_FAILED", {
        ...diagnostic,
        reason: "extension_request_failed",
      });
      sendResponse({ ok: false, reason: "extension_request_failed" });
    });
    return true;
  }
  if (message?.type === STAR_GMAIL_THREAD) {
    const diagnostic = {
      accountIndex: message.accountIndex,
      correlationId: message.correlationId,
      threadRef: message.threadRef,
    };
    recordDiagnostic("info", "GMAIL_THREAD_STAR_STARTED", diagnostic);
    chrome.tabs.query({ url: "https://mail.google.com/*" }).then(async (tabs) => {
      const tab = selectGmailMetadataTab(tabs, message);
      if (!tab) {
        recordDiagnostic("warn", "GMAIL_THREAD_STAR_FAILED", {
          ...diagnostic,
          reason: "matching_tab_not_found",
        });
        sendResponse({ ok: false, reason: "matching_tab_not_found" });
        return;
      }
      const response = await chrome.tabs.sendMessage(tab.id, {
        threadRef: message.threadRef,
        type: STAR_VISIBLE_GMAIL_THREAD,
      });
      if (!response?.ok) {
        recordDiagnostic("warn", "GMAIL_THREAD_STAR_FAILED", {
          ...diagnostic,
          reason: response?.reason ?? "star_failed",
        });
        sendResponse({ ok: false, reason: response?.reason ?? "star_failed" });
        return;
      }
      recordDiagnostic("info", "GMAIL_THREAD_STAR_COMPLETE", diagnostic);
      sendResponse({ ok: true });
    }).catch(() => {
      recordDiagnostic("warn", "GMAIL_THREAD_STAR_FAILED", {
        ...diagnostic,
        reason: "extension_request_failed",
      });
      sendResponse({ ok: false, reason: "extension_request_failed" });
    });
    return true;
  }
  if (message?.type === GET_GMAIL_THREAD_PARTICIPANTS) {
    const diagnostic = {
      accountIndex: message.accountIndex,
      correlationId: message.correlationId,
      droppedThreadRef: message.threadRef,
    };
    recordDiagnostic("info", "GMAIL_METADATA_TAB_LOOKUP_STARTED", diagnostic);
    chrome.tabs.query({ url: "https://mail.google.com/*" }).then(async (tabs) => {
      const tab = selectGmailMetadataTab(tabs, message);
      if (!tab) {
        recordDiagnostic("warn", "GMAIL_METADATA_TAB_NOT_FOUND", diagnostic);
        sendResponse({ gmailParticipants: null, gmailSubject: null, returnedThreadRef: null });
        return;
      }
      const matched = { ...diagnostic, matchedTabId: tab.id };
      recordDiagnostic("info", "GMAIL_METADATA_TAB_MATCHED", matched);
      recordDiagnostic("info", "GMAIL_METADATA_REQUEST_SENT", matched);
      let response;
      try {
        let recovered = false;
        response = await requestVisibleGmailMetadata({
          injectContentScript: async (tabId) => {
            await chrome.scripting.executeScript({
              files: ["gmail-drag-bridge.js"],
              target: { tabId },
            });
            recovered = true;
          },
          sendMessage: (tabId, request) => chrome.tabs.sendMessage(tabId, request),
          tabId: tab.id,
          threadRef: message.threadRef,
        });
        if (recovered) {
          recordDiagnostic("info", "GMAIL_METADATA_CONTENT_SCRIPT_RECOVERED", matched);
        }
      } catch {
        recordDiagnostic("warn", "GMAIL_ASSIGNEE_UPDATE_FAILED", {
          ...matched,
          reason: "gmail_content_script_unavailable",
        });
        sendResponse({ gmailParticipants: null, gmailSubject: null, returnedThreadRef: null });
        return;
      }
      const gmailParticipants = response?.gmailParticipants ?? response?.participants ?? null;
      const gmailSubject = response?.gmailSubject ?? response?.subject ?? null;
      const normalizedResponse = { ...response, gmailParticipants, gmailSubject };
      const received = {
        ...matched,
        fromExists: Boolean(gmailParticipants?.from),
        returnedThreadRef: normalizedResponse?.threadRef ?? null,
        subjectPresent: Boolean(gmailSubject),
        toCount: gmailParticipants?.to?.length ?? 0,
      };
      recordDiagnostic("info", "GMAIL_METADATA_RESPONSE_RECEIVED", received);
      const verified = verifyVisibleGmailParticipants(normalizedResponse, message.threadRef);
      if (verified.status === "thread_mismatch") {
        recordDiagnostic("warn", "GMAIL_METADATA_THREAD_MISMATCH", received);
        sendResponse({
          gmailParticipants: null,
          gmailSubject: null,
          returnedThreadRef: normalizedResponse?.threadRef ?? null,
        });
        return;
      }
      if (verified.status === "participants_unavailable") {
        recordDiagnostic("warn", "GMAIL_ASSIGNEE_UPDATE_FAILED", {
          ...received,
          reason: "participant_extraction_failed",
        });
        sendResponse({
          gmailParticipants: null,
          gmailSubject,
          participants: null,
          returnedThreadRef: normalizedResponse.threadRef,
          subject: gmailSubject,
          threadRef: normalizedResponse.threadRef,
        });
        return;
      }
      recordDiagnostic("info", "GMAIL_PARTICIPANTS_RESOLVED_FROM_OPEN_TAB", received);
      sendResponse({
        gmailParticipants: verified.gmailParticipants,
        gmailSubject,
        participants: verified.gmailParticipants,
        returnedThreadRef: normalizedResponse.threadRef,
        subject: gmailSubject,
        threadRef: normalizedResponse.threadRef,
      });
    }).catch(() => {
      recordDiagnostic("warn", "GMAIL_METADATA_TAB_NOT_FOUND", {
        ...diagnostic,
        reason: "tab_query_failed",
      });
      sendResponse({ gmailParticipants: null, gmailSubject: null, returnedThreadRef: null });
    });
    return true;
  }
  if (!isOpenInAuxMessage(message)) return false;
  routeOpenInAuxMessage({ controller, currentWorkArea, message, reportDrawerState })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ error: error.message, ok: false }));
  return true;
});

connectNativeHost();
