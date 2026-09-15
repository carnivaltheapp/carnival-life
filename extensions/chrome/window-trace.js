const PREFIX = "CARNIVAL_WINDOW_TRACE";
const WORKSPACE_STORAGE_KEY = "carnivalDesktopWorkspace";
const SNAPSHOT_DELAYS_MS = [0, 250, 500, 1000, 2000, 5000];
const PLAYHOUSE_ORIGIN = "https://carnival-playhouse.vercel.app";
const AUX_HOSTS = new Set([
  "calendar.google.com",
  "contacts.google.com",
  "mail.google.com",
  "slack.com",
]);

function compactBounds(value) {
  return value ? {
    focused: value.focused === true,
    height: value.height ?? null,
    left: value.left ?? null,
    state: value.state ?? null,
    top: value.top ?? null,
    type: value.type ?? null,
    width: value.width ?? null,
  } : null;
}

export function classifyWindowTraceUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin === PLAYHOUSE_ORIGIN) return { classification: "PLAYHOUSE" };
    const hostname = url.hostname.toLowerCase();
    if (AUX_HOSTS.has(hostname) || hostname.endsWith(".slack.com")) {
      return { classification: "AUX", hostname };
    }
    return url.protocol === "http:" || url.protocol === "https:"
      ? { classification: "OTHER", hostname }
      : { classification: "OTHER" };
  } catch {
    return { classification: "OTHER" };
  }
}

function summarizeTab(tab) {
  return {
    active: tab?.active === true,
    status: tab?.status ?? null,
    tabId: tab?.id ?? null,
    ...classifyWindowTraceUrl(tab?.url),
  };
}
function summarizeWindow(window, saved = {}) {
  const tabs = Array.isArray(window?.tabs) ? window.tabs.map(summarizeTab) : [];
  const hasPlayhouse = tabs.some(({ classification }) => classification === "PLAYHOUSE");
  const hasAux = tabs.some(({ classification }) => classification === "AUX");
  const classification = hasPlayhouse
    ? "PLAYHOUSE"
    : window?.id === saved.auxWindowId || hasAux ? "AUX" : "OTHER";
  return {
    ...compactBounds(window),
    classification,
    savedAuxIdMatch: window?.id === saved.auxWindowId,
    savedPlayhouseIdMatch: window?.id === saved.phWindowId,
    tabs,
    windowId: window?.id ?? null,
  };
}

function summarizeSavedState(value) {
  const state = value ?? {};
  return {
    auxActiveTabId: state.auxActiveTabId ?? state.contextTabId ?? null,
    auxGeometry: state.auxSession?.geometry ?? state.contextBounds ?? null,
    auxRoleTabIds: state.auxRoleTabIds ?? state.contextRoleTabIds ?? {},
    auxWindowId: state.auxWindowId ?? state.contextWindowId ?? null,
    drawerState: state.drawerState ?? null,
    lastSessionCycle: state.lastSessionCycle ?? null,
    layoutVersion: state.layoutVersion ?? null,
    monitorId: state.monitorId ?? null,
    phGeometry: state.phSession?.geometry ?? state.playhouseBounds ?? null,
    phPrimaryTabId: state.phPrimaryTabId ?? state.playhouseTabId ?? null,
    phWindowId: state.phWindowId ?? state.playhouseWindowId ?? null,
    sessionCycle: state.sessionCycle ?? null,
    workArea: state.workArea ?? null,
  };
}

function sanitizedStack() {
  return (new Error().stack ?? "")
    .split("\n")
    .slice(2, 8)
    .map((line) => line
      .trim()
      .replace(/chrome-extension:\/\/[^/]+/g, "chrome-extension://<extension>")
      .replace(/https?:\/\/[^\s)]+/g, "<url>"));
}

export function createWindowTrace({
  chromeApi,
  getNativeState = () => ({}),
  logger = console,
  now = () => new Date(),
  randomId = () => crypto.randomUUID(),
  schedule = (callback, delay) => setTimeout(callback, delay),
} = {}) {
  let active = false;
  let concurrentStartupDetected = false;
  let createdAtStart = null;
  let initialCounts = null;
  let sequence = 0;
  let startPromise = null;
  let startupTraceId = null;
  const counters = { auxEnsureInFlight: 0, playhouseEnsureInFlight: 0, workspaceInitInFlight: 0 };
  const createCalls = [];
  const createdWindows = new Map();
  const records = [];

  function emit(source, event, details = {}) {
    if (!active) return null;
    const record = {
      event,
      seq: ++sequence,
      source,
      startupTraceId,
      timestamp: now().toISOString(),
      ...details,
    };
    records.push(record);
    logger.info(`${PREFIX} ${JSON.stringify(record)}`);
    return record;
  }

  async function savedState(reason) {
    if (!active) return {};
    const local = await chromeApi.storage.local.get(WORKSPACE_STORAGE_KEY);
    let session = {};
    try {
      session = chromeApi.storage.session
        ? await chromeApi.storage.session.get(WORKSPACE_STORAGE_KEY)
        : {};
    } catch {
      session = {};
    }
    const state = summarizeSavedState(local[WORKSPACE_STORAGE_KEY]);
    emit("storage", "SAVED_WINDOW_STATE", {
      counters: { ...counters },
      localStorageUsed: false,
      nativeHostState: getNativeState(),
      reason,
      sessionStorageHasWorkspaceState: Boolean(session[WORKSPACE_STORAGE_KEY]),
      state,
    });
    return state;
  }

  async function getWindows(saved = {}) {
    const windows = await chromeApi.windows.getAll({ populate: true });
    return windows.map((window) => summarizeWindow(window, saved));
  }

  function counts(windows) {
    return {
      auxCount: windows.filter(({ classification }) => classification === "AUX").length,
      otherCount: windows.filter(({ classification }) => classification === "OTHER").length,
      playhouseCount: windows.filter(({ classification }) => classification === "PLAYHOUSE").length,
    };
  }

  async function snapshot(label) {
    const saved = await savedState(`snapshot:${label}`);
    const windows = await getWindows(saved);
    const windowCounts = counts(windows);
    if (label === "T+0ms") initialCounts = windowCounts;
    emit("background", "WINDOW_SNAPSHOT", { label, ...windowCounts, windows });
    return { ...windowCounts, windows };
  }

  async function summary() {
    const final = await snapshot("T+5000ms");
    const carnivalIds = new Set(createCalls.flatMap(({ resultWindowId }) => (
      Number.isInteger(resultWindowId) ? [resultWindowId] : []
    )));
    const created = [...createdWindows.values()].map((window) => ({
      ...window,
      inferredCreator: carnivalIds.has(window.windowId) ? "CARNIVAL" : "CHROME_OR_EXTERNAL",
    }));
    let suspectedDuplicateCause = "INSUFFICIENT_EVIDENCE";
    if (concurrentStartupDetected) suspectedDuplicateCause = "CONCURRENT_STARTUP_OBSERVED";
    else if ((initialCounts?.playhouseCount ?? 0) > 0 &&
      createCalls.some(({ role }) => role === "PLAYHOUSE")) {
      suspectedDuplicateCause = "PLAYHOUSE_EXISTED_BEFORE_CARNIVAL_CREATE";
    } else if (created.some(({ inferredCreator }) => inferredCreator === "CHROME_OR_EXTERNAL")) {
      suspectedDuplicateCause = "WINDOW_APPEARED_WITHOUT_CARNIVAL_CREATE_CALL";
    }
    emit("background", "CARNIVAL_WINDOW_TRACE_SUMMARY", {
      concurrentStartupDetected,
      createCallCountByRole: {
        AUX: createCalls.filter(({ role }) => role === "AUX").length,
        OTHER: createCalls.filter(({ role }) => role === "OTHER").length,
        PLAYHOUSE: createCalls.filter(({ role }) => role === "PLAYHOUSE").length,
      },
      createdDuringTrace: created,
      final: {
        auxCount: final.auxCount,
        playhouseCount: final.playhouseCount,
      },
      initial: initialCounts,
      savedAuxWindowId: (await savedState("final-summary")).auxWindowId,
      savedPlayhouseWindowId: (await savedState("final-summary")).phWindowId,
      suspectedDuplicateCause,
    });
  }

  async function start(reason) {
    if (startPromise) return startPromise;
    active = true;
    startupTraceId = `WT-${randomId()}`;
    createdAtStart = now().toISOString();
    startPromise = (async () => {
      emit("background", "WORKSPACE_INITIALIZATION_ENTER", {
        counters: { ...counters },
        createdAtStart,
        reason,
      });
      await snapshot("T+0ms");
      for (const delay of SNAPSHOT_DELAYS_MS.slice(1, -1)) {
        schedule(() => snapshot(`T+${delay}ms`).catch((error) => {
          emit("background", "TRACE_SNAPSHOT_FAILED", { reason: error?.message ?? "unknown" });
        }), delay);
      }
      schedule(() => summary().catch((error) => {
        emit("background", "TRACE_SUMMARY_FAILED", { reason: error?.message ?? "unknown" });
      }), SNAPSHOT_DELAYS_MS.at(-1));
      return startupTraceId;
    })();
    return startPromise;
  }

  function enter(scope, details = {}) {
    const key = scope === "playhouse"
      ? "playhouseEnsureInFlight"
      : scope === "aux" ? "auxEnsureInFlight" : "workspaceInitInFlight";
    counters[key] += 1;
    emit(details.source ?? "workspace", `${scope.toUpperCase()}_ENTER`, {
      ...details,
      counters: { ...counters },
    });
    if (counters[key] > 1) {
      concurrentStartupDetected = true;
      emit(details.source ?? "workspace", "CONCURRENT_STARTUP_DETECTED", {
        counters: { ...counters },
        scope,
      });
    }
  }

  function exit(scope, details = {}) {
    const key = scope === "playhouse"
      ? "playhouseEnsureInFlight"
      : scope === "aux" ? "auxEnsureInFlight" : "workspaceInitInFlight";
    counters[key] = Math.max(0, counters[key] - 1);
    emit(details.source ?? "workspace", `${scope.toUpperCase()}_EXIT`, {
      ...details,
      counters: { ...counters },
    });
  }

  async function discovery(role, savedWindowId) {
    emit("workspace-controller", `${role}_DISCOVERY_START`, { savedWindowId });
    const saved = await savedState(`${role.toLowerCase()}-discovery`);
    const windows = await getWindows(saved);
    const candidates = windows.map((window) => ({
      classification: window.classification,
      matched: window.windowId === savedWindowId,
      reason: window.windowId === savedWindowId ? "SAVED_ID_EXISTS" : "SAVED_ID_MISMATCH",
      savedIdMatch: window.windowId === savedWindowId,
      tabs: window.tabs,
      windowId: window.windowId,
    }));
    const selected = candidates.find(({ matched }) => matched)?.windowId ?? null;
    emit("workspace-controller", `${role}_DISCOVERY_RESULT`, {
      candidates,
      savedWindowId,
      selectedWindowId: selected,
    });
    return selected;
  }

  async function beforeCreate({ bounds, kind, reason, urls }) {
    const role = kind === "playhouse" ? "PLAYHOUSE" : kind === "context" ? "AUX" : "OTHER";
    const saved = await savedState("before-window-create");
    const windows = await getWindows(saved);
    const matchingIds = windows
      .filter(({ classification }) => classification === role)
      .map(({ windowId }) => windowId);
    const call = {
      callId: `create-${createCalls.length + 1}`,
      resultWindowId: null,
      role,
    };
    createCalls.push(call);
    emit("workspace-controller", "WINDOW_CREATE_CALL", {
      caller: "createWindowFromTabs",
      callId: call.callId,
      existingMatchingWindowFound: matchingIds.length > 0,
      existingMatchingWindowIds: matchingIds,
      pendingCreationState: { ...counters },
      reason,
      requestedGeometry: bounds,
      requestedRole: role,
      requestedUrls: urls.map(classifyWindowTraceUrl),
      savedWindowId: role === "PLAYHOUSE" ? saved.phWindowId : saved.auxWindowId,
      stack: sanitizedStack(),
    });
    return call.callId;
  }

  function afterCreate(callId, kind, window) {
    const role = kind === "playhouse" ? "PLAYHOUSE" : kind === "context" ? "AUX" : "OTHER";
    const call = createCalls.find((candidate) => candidate.callId === callId);
    if (call) call.resultWindowId = window?.id ?? null;
    emit("workspace-controller", "WINDOW_CREATE_RESULT", {
      actualGeometry: compactBounds(window),
      callId,
      role,
      tabId: window?.tabs?.find(({ active }) => active)?.id ?? window?.tabs?.[0]?.id ?? null,
      windowId: window?.id ?? null,
    });
  }

  function createFailed(callId, kind, error) {
    emit("workspace-controller", "WINDOW_CREATE_FAILED", {
      callId,
      reason: error?.message ?? "unknown",
      role: kind === "playhouse" ? "PLAYHOUSE" : kind === "context" ? "AUX" : "OTHER",
    });
  }

  async function beforeUpdate(windowId, options, reason) {
    await savedState(`before-window-update:${reason}`);
    emit("workspace-controller", "WINDOW_UPDATE_CALL", {
      options,
      reason,
      windowId,
    });
  }

  function chromeWindowCreated(window) {
    if (!active) return;
    const summarized = { ...compactBounds(window), windowId: window?.id ?? null };
    createdWindows.set(window?.id, summarized);
    emit("background", "CHROME_WINDOW_ON_CREATED", summarized);
    schedule(async () => {
      try {
        const populated = await chromeApi.windows.get(window.id, { populate: true });
        const saved = await savedState("chrome-window-created-classification");
        const classified = summarizeWindow(populated, saved);
        createdWindows.set(window.id, classified);
        emit("background", "CHROME_WINDOW_CLASSIFIED", classified);
      } catch (error) {
        emit("background", "CHROME_WINDOW_CLASSIFICATION_FAILED", {
          reason: error?.message ?? "window-unavailable",
          windowId: window?.id ?? null,
        });
      }
    }, 100);
  }

  function chromeWindowRemoved(windowId) {
    emit("background", "CHROME_WINDOW_ON_REMOVED", { windowId });
  }

  function tabEvent(event, tab, changeInfo = {}) {
    if (!active) return;
    const url = changeInfo.url ?? tab?.url;
    const classification = classifyWindowTraceUrl(url);
    if (classification.classification === "OTHER") return;
    emit("background", event, {
      ...classification,
      active: tab?.active === true,
      status: changeInfo.status ?? tab?.status ?? null,
      tabId: tab?.id ?? null,
      windowId: tab?.windowId ?? null,
    });
  }

  return {
    afterCreate,
    beforeCreate,
    beforeUpdate,
    chromeWindowCreated,
    chromeWindowRemoved,
    createFailed,
    discovery,
    emit,
    enter,
    exit,
    get active() { return active; },
    get records() { return [...records]; },
    start,
    tabEvent,
  };
}
