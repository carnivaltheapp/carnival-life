const PREFIX = "CARNIVAL_WINDOW_TRACE";
const WORKSPACE_STORAGE_KEY = "carnivalDesktopWorkspace";
export const WINDOW_TRACE_CURRENT_KEY = "carnivalWindowTraceCurrent";
export const WINDOW_TRACE_LATEST_KEY = "carnivalWindowTraceLatest";
export const WINDOW_TRACE_LIFECYCLE_KEY = "carnivalWindowTraceLifecycle";
export const WINDOW_TRACE_EVENT_LIMIT = 500;
const LIFECYCLE_EVENT_LIMIT = 25;
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
  let startupMode = "WARM";
  let coldStartAdoptionEligible = false;
  const coldStartCandidateWindowIds = new Set();
  let workspaceStartRequestCount = 0;
  const counters = { auxEnsureInFlight: 0, playhouseEnsureInFlight: 0, workspaceInitInFlight: 0 };
  const createCalls = [];
  const createdWindows = new Map();
  const tabMoveCalls = [];
  const windowRoles = new Map();
  const records = [];
  const pendingPersistence = [];
  let lifecycleQueue = Promise.resolve();
  let persistenceQueue = Promise.resolve();
  let persistenceScheduled = false;

  function persistEvents() {
    if (persistenceScheduled || pendingPersistence.length === 0) return;
    persistenceScheduled = true;
    persistenceQueue = persistenceQueue.then(async () => {
      persistenceScheduled = false;
      const batch = pendingPersistence.splice(0);
      if (!batch.length || !startupTraceId) return;
      const stored = await chromeApi.storage.local.get(WINDOW_TRACE_CURRENT_KEY);
      const prior = stored[WINDOW_TRACE_CURRENT_KEY];
      const current = prior?.traceId === startupTraceId
        ? prior
        : { events: [], startedAt: createdAtStart, summary: null, traceId: startupTraceId };
      const events = [...(current.events ?? []), ...batch].slice(-WINDOW_TRACE_EVENT_LIMIT);
      const summary = [...batch].reverse()
        .find(({ event }) => event === "CARNIVAL_WINDOW_TRACE_SUMMARY") ?? current.summary ?? null;
      const next = { ...current, events, summary };
      await chromeApi.storage.local.set({
        [WINDOW_TRACE_CURRENT_KEY]: next,
        ...(summary ? { [WINDOW_TRACE_LATEST_KEY]: next } : {}),
      });
    }).catch((error) => logger.error?.(`${PREFIX} persistence failed`, error?.message ?? "unknown"));
  }

  function queuePersistence(record) {
    pendingPersistence.push(record);
    persistEvents();
  }

  async function drainPersistence() {
    while (persistenceScheduled || pendingPersistence.length > 0) {
      persistEvents();
      await persistenceQueue;
    }
  }

  function recordLifecycle(event, details = {}) {
    const entry = {
      details,
      event,
      source: "background",
      timestamp: now().toISOString(),
    };
    lifecycleQueue = lifecycleQueue.then(async () => {
      const stored = await chromeApi.storage.local.get(WINDOW_TRACE_LIFECYCLE_KEY);
      const entries = Array.isArray(stored[WINDOW_TRACE_LIFECYCLE_KEY])
        ? stored[WINDOW_TRACE_LIFECYCLE_KEY]
        : [];
      await chromeApi.storage.local.set({
        [WINDOW_TRACE_LIFECYCLE_KEY]: [...entries, entry].slice(-LIFECYCLE_EVENT_LIMIT),
      });
    }).catch((error) => logger.error?.(`${PREFIX} lifecycle persistence failed`, error?.message ?? "unknown"));
    return lifecycleQueue;
  }

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
    queuePersistence(record);
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
    if (label === "T+0ms") {
      initialCounts = windowCounts;
      windows.forEach((window) => windowRoles.set(window.windowId, window.classification));
    }
    emit("background", "WINDOW_SNAPSHOT", { label, ...windowCounts, windows });
    return { ...windowCounts, windows };
  }

  async function summary() {
    const completedTraceId = startupTraceId;
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
      CarnivalWindowCreateCalls: createCalls.length,
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
        windowCount: final.windows.length,
      },
      initial: { ...initialCounts, windowCount: initialCounts
        ? initialCounts.auxCount + initialCounts.otherCount + initialCounts.playhouseCount
        : 0 },
      savedAuxWindowId: (await savedState("final-summary")).auxWindowId,
      savedPlayhouseWindowId: (await savedState("final-summary")).phWindowId,
      startupMode,
      suspectedDuplicateCause,
      tabMoveCalls: tabMoveCalls.length,
      workspaceStartRequestCount,
    });
    await drainPersistence();
    if (startupTraceId === completedTraceId) {
      active = false;
      startPromise = null;
    }
  }

  async function start(reason) {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      await lifecycleQueue;
      const stored = await chromeApi.storage.local.get([
        WINDOW_TRACE_CURRENT_KEY,
        WINDOW_TRACE_LIFECYCLE_KEY,
      ]);
      const prior = stored[WINDOW_TRACE_CURRENT_KEY];
      const lifecycle = Array.isArray(stored[WINDOW_TRACE_LIFECYCLE_KEY])
        ? stored[WINDOW_TRACE_LIFECYCLE_KEY]
        : [];
      concurrentStartupDetected = false;
      initialCounts = null;
      sequence = 0;
      workspaceStartRequestCount = 0;
      counters.auxEnsureInFlight = 0;
      counters.playhouseEnsureInFlight = 0;
      counters.workspaceInitInFlight = 0;
      createCalls.length = 0;
      createdWindows.clear();
      records.length = 0;
      tabMoveCalls.length = 0;
      windowRoles.clear();
      coldStartCandidateWindowIds.clear();
      startupTraceId = `WT-${randomId()}`;
      createdAtStart = now().toISOString();
      active = true;
      const runtimeStartupEvent = [...lifecycle].reverse()
        .find(({ event }) => event === "CHROME_RUNTIME_ON_STARTUP");
      const runtimeStartupObserved = Boolean(runtimeStartupEvent);
      const runtimeStartupAgeMs = runtimeStartupEvent
        ? Math.max(0, now().getTime() - new Date(runtimeStartupEvent.timestamp).getTime())
        : null;
      startupMode = runtimeStartupObserved ? "COLD" : "WARM";
      coldStartAdoptionEligible = runtimeStartupAgeMs !== null && runtimeStartupAgeMs <= 10_000;
      await chromeApi.storage.local.set({
        [WINDOW_TRACE_CURRENT_KEY]: {
          events: [],
          startedAt: createdAtStart,
          summary: null,
          traceId: startupTraceId,
        },
        [WINDOW_TRACE_LIFECYCLE_KEY]: [],
        ...(prior?.summary ? { [WINDOW_TRACE_LATEST_KEY]: prior } : {}),
      });
      lifecycle.forEach((entry) => {
        emit(entry.source, entry.event, {
          ...entry.details,
          lifecycleObservedAt: entry.timestamp,
        });
        if (entry.event === "CHROME_WINDOW_ON_CREATED") {
          coldStartCandidateWindowIds.add(entry.details.windowId);
          windowRoles.set(entry.details.windowId, entry.details.classification ?? "OTHER");
        } else if (entry.event.startsWith("CHROME_TAB_") && entry.details.classification) {
          trackWindowRole(
            entry.details.windowId,
            entry.details.classification,
            `${entry.event}:before-workspace-initialization`,
          );
        }
      });
      emit("background", "WORKSPACE_INITIALIZATION_ENTER", {
        chromeRuntimeStartupObserved: runtimeStartupObserved,
        counters: { ...counters },
        createdAtStart,
        reason,
        startupMode,
        workspaceInitializationTriggeredDuringExtensionStartup: reason === "extension startup",
      });
      const initialSnapshot = await snapshot("T+0ms");
      if (coldStartAdoptionEligible && coldStartCandidateWindowIds.size === 0 &&
        initialSnapshot.windows.length === 1) {
        coldStartCandidateWindowIds.add(initialSnapshot.windows[0].windowId);
      }
      emit("background", "COLD_START_CONTEXT", {
        adoptionCandidateWindowIds: [...coldStartCandidateWindowIds],
        adoptionEligible: coldStartAdoptionEligible,
        initialAuxCount: initialCounts?.auxCount ?? 0,
        initialChromeWindowCount: (initialCounts?.auxCount ?? 0) +
          (initialCounts?.otherCount ?? 0) + (initialCounts?.playhouseCount ?? 0),
        initialPlayhouseCount: initialCounts?.playhouseCount ?? 0,
        noChromeWindowsAtTraceStart: !initialCounts ||
          initialCounts.auxCount + initialCounts.otherCount + initialCounts.playhouseCount === 0,
        startupMode,
        runtimeStartupAgeMs,
        triggerSource: classifyTriggerSource(reason),
        workspaceInitializationTriggeredDuringExtensionStartup: reason === "extension startup",
      });
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

  function classifyTriggerSource(source) {
    if (source === "native hot corner") return "native-host";
    if (source === "toolbar") return "user-command";
    if (source === "extension startup") return "extension-startup";
    if (source === "PlayHouse page") return "playhouse-page";
    return "other-known-source";
  }

  function workspaceStartRequest(source) {
    workspaceStartRequestCount += 1;
    emit("workspace-summon", "WORKSPACE_START_REQUEST", {
      reason: source,
      requestNumber: workspaceStartRequestCount,
      triggerSource: classifyTriggerSource(source),
    });
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
    emit("workspace-controller", "CREATE_WINDOW_FROM_TABS_ENTER", {
      currentNormalWindowCount: windows.filter(({ type }) => type === "normal").length,
      matchingAuxWindowIds: windows
        .filter(({ classification }) => classification === "AUX").map(({ windowId }) => windowId),
      matchingPlayhouseWindowIds: windows
        .filter(({ classification }) => classification === "PLAYHOUSE").map(({ windowId }) => windowId),
      originalWindowIds: [],
      requestedRole: role,
      source: "createWindowFromTabs",
      tabIdsBeingMoved: [],
      tabMovement: "NONE_CHROME_WINDOWS_CREATE_RECEIVES_URLS",
    });
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
    emit("workspace-controller", "CREATE_WINDOW_FROM_TABS_RESULT", {
      callId,
      role,
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
    const initialClassification = summarizeWindow(window).classification;
    const summarized = {
      ...compactBounds(window),
      classification: initialClassification,
      windowId: window?.id ?? null,
    };
    if (!active) {
      recordLifecycle("CHROME_WINDOW_ON_CREATED", summarized);
      return;
    }
    windowRoles.set(window?.id, initialClassification);
    createdWindows.set(window?.id, summarized);
    emit("background", "CHROME_WINDOW_ON_CREATED", summarized);
    schedule(async () => {
      try {
        const populated = await chromeApi.windows.get(window.id, { populate: true });
        const saved = await savedState("chrome-window-created-classification");
        const classified = summarizeWindow(populated, saved);
        createdWindows.set(window.id, classified);
        trackWindowRole(classified.windowId, classified.classification, "chrome.windows.onCreated");
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
    if (!active) {
      recordLifecycle("CHROME_WINDOW_ON_REMOVED", { windowId });
      return;
    }
    emit("background", "CHROME_WINDOW_ON_REMOVED", { windowId });
  }

  function trackWindowRole(windowId, classification, reason) {
    if (!Number.isInteger(windowId)) return;
    const previous = windowRoles.get(windowId);
    windowRoles.set(windowId, classification);
    if (previous && previous !== classification) {
      emit("background", "WINDOW_ROLE_CHANGED", {
        from: previous,
        reason,
        to: classification,
        windowId,
      });
    }
  }

  async function inspectWindowRole(windowId, reason) {
    if (!active || !Number.isInteger(windowId)) return;
    try {
      const populated = await chromeApi.windows.get(windowId, { populate: true });
      const saved = await savedState(`window-role:${reason}`);
      const classified = summarizeWindow(populated, saved);
      trackWindowRole(windowId, classified.classification, reason);
    } catch {
      // Window disappeared before the diagnostic role inspection completed.
    }
  }

  function tabEvent(event, tab, changeInfo = {}) {
    const url = changeInfo.url ?? tab?.url;
    const classification = classifyWindowTraceUrl(url);
    if (classification.classification === "OTHER") return;
    if (!active) {
      return recordLifecycle(event, {
        ...classification,
        active: tab?.active === true,
        status: changeInfo.status ?? tab?.status ?? null,
        tabId: tab?.id ?? null,
        windowId: tab?.windowId ?? null,
      });
    }
    emit("background", event, {
      ...classification,
      active: tab?.active === true,
      status: changeInfo.status ?? tab?.status ?? null,
      tabId: tab?.id ?? null,
      windowId: tab?.windowId ?? null,
    });
    return inspectWindowRole(tab?.windowId, event);
  }

  function tabMove({ classification = "OTHER", fromWindowId, tabId, toWindowId }) {
    const call = { classification, fromWindowId, tabId, toWindowId };
    tabMoveCalls.push(call);
    emit("workspace-controller", "TAB_MOVE_CALL", call);
  }

  async function workerLoaded() {
    let windows = [];
    try {
      windows = await chromeApi.windows.getAll({ populate: true });
    } catch {
      windows = [];
    }
    return recordLifecycle("EXTENSION_WORKER_LOADED", {
      auxCount: windows.filter((window) => summarizeWindow(window).classification === "AUX").length,
      initialChromeWindowCount: windows.length,
      playhouseCount: windows.filter((window) => summarizeWindow(window).classification === "PLAYHOUSE").length,
      windowsExisted: windows.length > 0,
    });
  }

  function runtimeStartup() {
    return recordLifecycle("CHROME_RUNTIME_ON_STARTUP");
  }

  function runtimeInstalled(reason) {
    return recordLifecycle("CHROME_RUNTIME_ON_INSTALLED", { reason: reason ?? null });
  }

  async function dump() {
    await drainPersistence();
    const stored = await chromeApi.storage.local.get([
      WINDOW_TRACE_CURRENT_KEY,
      WINDOW_TRACE_LATEST_KEY,
    ]);
    const trace = stored[WINDOW_TRACE_LATEST_KEY] ?? stored[WINDOW_TRACE_CURRENT_KEY] ?? null;
    logger.info("CARNIVAL_WINDOW_TRACE_BEGIN");
    if (trace) {
      const events = [...(trace.events ?? [])].sort((left, right) => left.seq - right.seq);
      events.filter(({ event }) => event !== "CARNIVAL_WINDOW_TRACE_SUMMARY")
        .forEach((record) => logger.info(`${PREFIX} ${JSON.stringify(record)}`));
      const traceSummary = trace.summary ??
        events.find(({ event }) => event === "CARNIVAL_WINDOW_TRACE_SUMMARY") ?? null;
      if (traceSummary) logger.info(`CARNIVAL_WINDOW_TRACE_SUMMARY ${JSON.stringify(traceSummary)}`);
    }
    logger.info("CARNIVAL_WINDOW_TRACE_END");
    return trace;
  }

  async function clear() {
    await lifecycleQueue;
    await drainPersistence();
    await chromeApi.storage.local.remove([
      WINDOW_TRACE_CURRENT_KEY,
      WINDOW_TRACE_LATEST_KEY,
      WINDOW_TRACE_LIFECYCLE_KEY,
    ]);
    active = false;
    coldStartAdoptionEligible = false;
    coldStartCandidateWindowIds.clear();
    startPromise = null;
    pendingPersistence.length = 0;
    return true;
  }

  return {
    afterCreate,
    beforeCreate,
    beforeUpdate,
    chromeWindowCreated,
    chromeWindowRemoved,
    clear,
    createFailed,
    discovery,
    dump,
    emit,
    enter,
    exit,
    get active() { return active; },
    get coldStartContext() {
      return {
        candidateWindowIds: [...coldStartCandidateWindowIds],
        eligible: coldStartAdoptionEligible,
        startupMode,
      };
    },
    get records() { return [...records]; },
    start,
    tabMove,
    tabEvent,
    runtimeInstalled,
    runtimeStartup,
    workerLoaded,
    workspaceStartRequest,
  };
}
