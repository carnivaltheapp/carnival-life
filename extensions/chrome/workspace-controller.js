import {
  AUX_HOT_TAB_ORDER,
  AUX_ROLE_URLS,
  HOT_TAB_ROLES,
  auxRoleForUrl,
  defaultAuxTabs,
  defaultMiscTabs,
  defaultPlayhouseTabs,
  isGoogleContactsUrl,
  snapshotTabs,
  validSavedTabs,
} from "./workspace-tabs.js";
import { waitForColdStartPlayhouse } from "./cold-start-playhouse.js";

export const PLAYHOUSE_URL = "https://carnival-playhouse.vercel.app/";
export const DEFAULT_CONTEXT_URL = "https://calendar.google.com/calendar/u/0/r";
export const OPEN_ANIMATION_MS = 450;
export const CLOSE_ANIMATION_MS = 400;
export const RETRACT_DISTANCE_PX = 100;
export const DRAWER_RIGHT_GUTTER_PX = RETRACT_DISTANCE_PX;

const STORAGE_KEY = "carnivalDesktopWorkspace";
const LAYOUT_VERSION = 2;
const DEFAULT_PLAYHOUSE_RATIO = 0.6;
const MINIMUM_VISIBLE_INTERSECTION_PX = 64;
const POST_RESTORE_GEOMETRY_SETTLE_MS = 500;
const COLD_START_CANDIDATE_TIMEOUT_MS = 3500;

function validInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export function isAllowedContextUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function validWorkArea(value) {
  return Boolean(
    value &&
    Number.isInteger(value.left) &&
    Number.isInteger(value.top) &&
    validInteger(value.width) &&
    validInteger(value.height) &&
    value.width >= 800 &&
    value.height >= 500,
  );
}

function availableWorkspaceWidth(workArea) {
  const activationGutter = Math.min(DRAWER_RIGHT_GUTTER_PX, Math.max(0, workArea.width - 800));
  return workArea.width - activationGutter;
}

export function defaultWorkspaceLayout(workArea) {
  if (!validWorkArea(workArea)) throw new Error("A valid monitor work area is required.");
  const total = availableWorkspaceWidth(workArea);
  const playhouseWidth = Math.round(total * DEFAULT_PLAYHOUSE_RATIO);
  return {
    context: {
      height: workArea.height,
      left: workArea.left + playhouseWidth,
      top: workArea.top,
      width: total - playhouseWidth,
    },
    playhouse: {
      height: workArea.height,
      left: workArea.left,
      top: workArea.top,
      width: playhouseWidth,
    },
  };
}

function storedBounds(value) {
  if (!value || !Number.isInteger(value.left) || !Number.isInteger(value.top)) return null;
  if (!validInteger(value.width) || !validInteger(value.height)) return null;
  return value.width >= 320 && value.height >= 400
    ? { height: value.height, left: value.left, top: value.top, width: value.width }
    : null;
}

function storedGeometry(value) {
  if (!value || !Number.isInteger(value.left) || !validInteger(value.width) || value.width < 320) {
    return null;
  }
  return { left: value.left, width: value.width };
}

function geometryFromBounds(value) {
  const bounds = storedBounds(value);
  return bounds ? { left: bounds.left, width: bounds.width } : null;
}

// PLAYHOUSE POSITION INVARIANT: X/Y always equal the active monitor work-area origin.
// Carnival may retain/change only the PlayHouse width (and full-work-area height).
export function getAnchoredPlayhouseGeometry(workArea, width) {
  if (!validWorkArea(workArea)) throw new Error("A valid monitor work area is required.");
  return {
    height: workArea.height,
    left: workArea.left,
    top: workArea.top,
    width: Math.max(320, Math.min(Number.isInteger(width) ? width : 320, workArea.width)),
  };
}

function legacySession(state, role) {
  const isPh = role === "ph";
  const geometry = storedGeometry(state[`${role}Session`]?.geometry) ?? geometryFromBounds(
    isPh
      ? state.savedVisibleBounds?.playhouse ?? state.playhouseBounds
      : state.savedVisibleBounds?.context ?? state.contextBounds,
  );
  const tabs = validSavedTabs(
    state[`${role}Session`]?.tabs ?? (isPh ? state.playhouseTabs : state.contextTabs),
    isPh ? "playhouse" : "context",
  );
  return { geometry, tabs };
}

function canonicalAuxSession(state) {
  const source = legacySession(state, "aux");
  const defaults = defaultAuxTabs();
  const byRole = new Map(source.tabs?.tabs.map((tab, index) => [tab.role, { ...tab, index }]) ?? []);
  const activeRole = source.tabs?.tabs[source.tabs.activeIndex]?.role ?? "calendar";
  const tabs = AUX_HOT_TAB_ORDER.map((role) => ({
    pinned: false,
    role,
    url: byRole.get(role)?.url ?? AUX_ROLE_URLS[role],
  }));
  return {
    geometry: source.geometry,
    tabs: {
      activeIndex: Math.max(0, AUX_HOT_TAB_ORDER.indexOf(activeRole)),
      tabs: tabs.length ? tabs : defaults.tabs,
    },
  };
}

function miscSession(state) {
  const explicit = validSavedTabs(state.miscSession?.tabs ?? state.miscTabs, "misc");
  const legacyAux = legacySession(state, "aux").tabs;
  const legacyExtras = legacyAux?.tabs.filter((tab) => (
    !AUX_HOT_TAB_ORDER.includes(tab.role) || tab.role === null
  )) ?? [];
  const migrated = legacyExtras.length ? {
    activeIndex: Math.max(0, legacyExtras.findIndex((tab) => (
      tab.url === legacyAux.tabs[legacyAux.activeIndex]?.url
    ))),
    tabs: legacyExtras.map((tab) => ({ pinned: tab.pinned, role: null, url: tab.url })),
  } : null;
  return {
    geometry: storedGeometry(state.miscSession?.geometry) ??
      storedGeometry(state.rightSlotGeometry) ?? legacySession(state, "aux").geometry,
    tabs: explicit ?? migrated,
  };
}

function normalizedRightSurface(value) {
  return value === "misc" ? "misc" : "aux";
}

function selectedRightWindowId(state) {
  return normalizedRightSurface(state.rightSurface) === "misc"
    ? state.miscWindowId
    : state.auxWindowId;
}

function selectedRightSession(state) {
  return normalizedRightSurface(state.rightSurface) === "misc"
    ? state.miscSession
    : state.auxSession;
}

function normalizedWorkspaceState(raw) {
  const phWindowId = Object.hasOwn(raw, "phWindowId") ? raw.phWindowId : raw.playhouseWindowId ?? null;
  const auxWindowId = Object.hasOwn(raw, "auxWindowId") ? raw.auxWindowId : raw.contextWindowId ?? null;
  const phPrimaryTabId = Object.hasOwn(raw, "phPrimaryTabId")
    ? raw.phPrimaryTabId : raw.playhouseTabId ?? null;
  const auxActiveTabId = Object.hasOwn(raw, "auxActiveTabId")
    ? raw.auxActiveTabId : raw.contextTabId ?? null;
  const auxRoleTabIds = Object.hasOwn(raw, "auxRoleTabIds")
    ? raw.auxRoleTabIds : raw.contextRoleTabIds ?? {};
  const phSession = legacySession(raw, "ph");
  const anchoredPhSession = validWorkArea(raw.workArea) && phSession.geometry
    ? { ...phSession, geometry: { ...phSession.geometry, left: raw.workArea.left } }
    : phSession;
  const storedPlayhouseBounds = storedBounds(raw.playhouseBounds);
  const rightSurface = normalizedRightSurface(raw.rightSurface);
  const normalizedAuxSession = canonicalAuxSession(raw);
  const normalizedMiscSession = miscSession(raw);
  const rightSlotGeometry = storedGeometry(raw.rightSlotGeometry) ??
    storedGeometry(rightSurface === "misc" ? normalizedMiscSession.geometry : normalizedAuxSession.geometry) ??
    storedGeometry(normalizedAuxSession.geometry) ?? storedGeometry(normalizedMiscSession.geometry);
  return {
    ...raw,
    auxActiveTabId,
    auxRoleTabIds,
    auxSession: normalizedAuxSession,
    auxWindowId,
    contextRoleTabIds: auxRoleTabIds,
    contextTabId: auxActiveTabId,
    contextWindowId: auxWindowId,
    phPrimaryTabId,
    phSession: anchoredPhSession,
    phWindowId,
    miscSession: normalizedMiscSession,
    miscWindowId: Number.isInteger(raw.miscWindowId) ? raw.miscWindowId : null,
    rightSlotGeometry,
    rightSurface,
    ...(validWorkArea(raw.workArea) && storedPlayhouseBounds ? {
      playhouseBounds: getAnchoredPlayhouseGeometry(raw.workArea, storedPlayhouseBounds.width),
    } : {}),
    playhouseTabId: phPrimaryTabId,
    playhouseWindowId: phWindowId,
  };
}

function horizontalBoundsFitWorkArea(bounds, workArea) {
  return bounds.left >= workArea.left &&
    bounds.left + bounds.width <= workArea.left + workArea.width;
}

function hasVisibleIntersection(window, workArea) {
  const bounds = storedBounds(window);
  if (!bounds || window.state === "minimized") return false;
  const visibleWidth = Math.max(0, Math.min(bounds.left + bounds.width,
    workArea.left + workArea.width) - Math.max(bounds.left, workArea.left));
  const visibleHeight = Math.max(0, Math.min(bounds.top + bounds.height,
    workArea.top + workArea.height) - Math.max(bounds.top, workArea.top));
  return visibleWidth >= MINIMUM_VISIBLE_INTERSECTION_PX &&
    visibleHeight >= MINIMUM_VISIBLE_INTERSECTION_PX;
}

function restoreWindowBounds(bounds, priorWorkArea, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const relativeLeft = bounds.left - (validWorkArea(priorWorkArea) ? priorWorkArea.left : workArea.left);
  const left = Math.max(workArea.left,
    Math.min(workArea.left + relativeLeft, workArea.left + workArea.width - width));
  return { height: workArea.height, left, top: workArea.top, width };
}

export function canonicalWorkspaceLayout(prior, workArea) {
  const fallback = defaultWorkspaceLayout(workArea);
  if (prior.layoutVersion !== LAYOUT_VERSION) return fallback;
  const phGeometry = storedGeometry(prior.phSession?.geometry) ?? geometryFromBounds(
    prior.savedVisibleBounds?.playhouse ?? prior.playhouseBounds,
  );
  const auxGeometry = storedGeometry(prior.rightSlotGeometry) ??
    storedGeometry(selectedRightSession(prior)?.geometry) ??
    storedGeometry(prior.auxSession?.geometry) ?? geometryFromBounds(
    prior.savedVisibleBounds?.context ?? prior.contextBounds,
  );
  if (!phGeometry || !auxGeometry) return fallback;
  const priorWorkArea = validWorkArea(prior.workArea) ? prior.workArea : workArea;
  const playhouse = getAnchoredPlayhouseGeometry(workArea, phGeometry.width);
  const context = {
    height: priorWorkArea.height,
    left: auxGeometry.left,
    top: priorWorkArea.top,
    width: auxGeometry.width,
  };
  return {
    context: restoreWindowBounds(context, prior.workArea, workArea),
    playhouse,
  };
}

export const restoredWorkspaceLayout = canonicalWorkspaceLayout;

function actualRestingBounds(window, workArea) {
  const bounds = storedBounds(window);
  if (!bounds || !hasVisibleIntersection(window, workArea) ||
    !horizontalBoundsFitWorkArea(bounds, workArea)) return null;
  return { ...bounds, height: workArea.height, top: workArea.top };
}

export function compareAnimationLanding(actualValue, targetValue, tolerance = 2) {
  const actual = storedBounds(actualValue);
  const target = storedBounds(targetValue);
  if (!actual || !target) return { landed: false, leftDelta: null };
  const deltas = {
    height: actual.height - target.height,
    left: actual.left - target.left,
    top: actual.top - target.top,
    width: actual.width - target.width,
  };
  return {
    landed: Object.values(deltas).every((delta) => Math.abs(delta) <= tolerance),
    leftDelta: deltas.left,
  };
}

export function effectiveRetractThreshold(rightEdge, monitorRight) {
  return Math.min(rightEdge + RETRACT_DISTANCE_PX, monitorRight - 1);
}

function shifted(bounds, offset) {
  return { ...bounds, left: bounds.left + offset };
}

export function canonicalRetractedWorkspaceLayout(visibleLayout, workArea) {
  if (!validWorkArea(workArea)) throw new Error("A valid monitor work area is required.");
  return {
    context: shifted(visibleLayout.context, -workArea.width),
    playhouse: shifted(visibleLayout.playhouse, -workArea.width),
  };
}

function currentBounds(window, fallback) {
  return storedBounds(window) ?? fallback;
}

async function existingWindow(chromeApi, windowId) {
  if (!Number.isInteger(windowId)) return null;
  try {
    return await chromeApi.windows.get(windowId, { populate: true });
  } catch {
    return null;
  }
}

async function existingTab(chromeApi, tabId) {
  if (!Number.isInteger(tabId)) return null;
  try {
    return await chromeApi.tabs.get(tabId);
  } catch {
    return null;
  }
}

function roleTabIds(definitions, tabs) {
  return Object.fromEntries(definitions.tabs.flatMap((definition, index) => (
    definition.role && tabs[index]?.id ? [[definition.role, tabs[index].id]] : []
  )));
}

function isPlayhouseUrl(value) {
  return typeof value === "string" && value.startsWith(PLAYHOUSE_URL);
}

function hostnameForDiagnostic(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function logicalTabState(tabs) {
  const ordered = [...tabs].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  return {
    activeIndex: Math.max(0, ordered.findIndex((tab) => tab.active)),
    tabs: ordered.map((tab) => ({ pinned: tab.pinned === true, url: tab.url })),
  };
}

function orderedUrlsMatch(tabs, savedTabs) {
  const saved = validSavedTabs(savedTabs, "misc");
  if (!saved || tabs.length !== saved.tabs.length) return false;
  return [...tabs]
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .every((tab, index) => tab.url === saved.tabs[index].url);
}

function diagnosticSession(session) {
  return {
    activeIndex: session?.tabs?.activeIndex ?? null,
    geometry: session?.geometry ?? null,
    hostnames: session?.tabs?.tabs?.map((tab) => hostnameForDiagnostic(tab.url)) ?? [],
    roles: session?.tabs?.tabs?.map((tab) => tab.role ?? "ordinary") ?? [],
    tabCount: session?.tabs?.tabs?.length ?? 0,
  };
}

function newSessionCycleId() {
  return `R29-${Date.now().toString(36)}`;
}

export class CarnivalWorkspaceController {
  constructor(chromeApi, options = {}) {
    this.chrome = chromeApi;
    this.logger = options.logger ?? console;
    this.windowTrace = options.windowTrace ?? null;
    this.coldStartCandidateTimeoutMs = options.coldStartCandidateTimeoutMs ??
      COLD_START_CANDIDATE_TIMEOUT_MS;
    this.nativeActivate = options.nativeActivate ?? null;
    this.nativeAnimate = options.nativeAnimate ?? null;
    this.phSessionDiagnostics = options.phSessionDiagnostics ?? null;
    this.movingWindowIds = new Set();
    this.phRestoreInProgress = false;
    this.auxRestoreInProgress = false;
    this.miscRestoreInProgress = false;
    this.auxRepairInProgress = false;
    this.restoreWindowRoles = new Map();
    this.systemGeometryWindowIds = new Set();
    this.systemGeometryTimers = new Map();
    this.geometrySettleMs = options.geometrySettleMs ?? POST_RESTORE_GEOMETRY_SETTLE_MS;
    this.creatingRestoreRole = null;
    this.stateUpdates = Promise.resolve();
    this.transitioning = false;
  }

  recordPhSessionDiagnostic(event, details = {}) {
    try {
      return this.phSessionDiagnostics?.record(event, details) ?? Promise.resolve();
    } catch {
      // PH session diagnostics must never affect workspace behavior.
      return Promise.resolve();
    }
  }

  async flushPhSessionDiagnostics() {
    try {
      await this.phSessionDiagnostics?.drain?.();
    } catch {
      // PH session diagnostics must never affect workspace behavior.
    }
  }

  restoreRoleForWindow(windowId) {
    return this.restoreWindowRoles.get(windowId) ?? this.creatingRestoreRole;
  }

  isRestoreInProgress(windowId) {
    const role = this.restoreRoleForWindow(windowId);
    return role === "playhouse" ? this.phRestoreInProgress
      : role === "context" ? this.auxRestoreInProgress
        : role === "misc" ? this.miscRestoreInProgress : false;
  }

  isSystemGeometryChange(windowId) {
    return this.transitioning || this.movingWindowIds.has(windowId) ||
      this.systemGeometryWindowIds.has(windowId) || this.isRestoreInProgress(windowId);
  }

  logRestoreSaveSkipped(windowId, reason) {
    const role = this.restoreRoleForWindow(windowId);
    const eventPrefix = role === "playhouse" ? "PH"
      : role === "context" ? "AUX" : role === "misc" ? "MISC" : "WORKSPACE";
    this.logger.info?.(`${eventPrefix}_SESSION_SAVE_SKIPPED`, {
      reason: "restore-in-progress",
      source: reason,
      windowId,
    });
  }

  logSystemGeometrySaveSkipped(windowId) {
    this.logger.info?.("GEOMETRY_SAVE_SKIPPED", {
      reason: "system-change",
      windowId,
    });
    if (this.systemGeometryWindowIds.has(windowId)) this.settleSystemGeometry(windowId);
  }

  settleSystemGeometry(windowId) {
    clearTimeout(this.systemGeometryTimers.get(windowId));
    this.systemGeometryTimers.set(windowId, setTimeout(() => {
      this.systemGeometryTimers.delete(windowId);
      this.systemGeometryWindowIds.delete(windowId);
    }, this.geometrySettleMs));
  }

  async state() {
    const raw = (await this.chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? {};
    return normalizedWorkspaceState(raw);
  }

  async save(nextState) {
    const normalized = normalizedWorkspaceState(nextState);
    await this.chrome.storage.local.set({ [STORAGE_KEY]: normalized });
    return normalized;
  }

  async updateState(update) {
    const operation = this.stateUpdates.then(async () => {
      const current = await this.state();
      const next = update(current);
      if (!next) return null;
      return this.save(next);
    });
    this.stateUpdates = operation.catch(() => {});
    return operation;
  }

  async tabsInWindow(windowId) {
    return (await this.chrome.tabs.query({ windowId }))
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  }

  async playhouseCandidateCount() {
    try {
      const windows = await this.chrome.windows.getAll({ populate: true });
      return windows.filter((window) => (
        window.tabs?.some((tab) => isPlayhouseUrl(tab.url))
      )).length;
    } catch {
      return null;
    }
  }

  async updateWindow(windowId, options, reason) {
    await this.windowTrace?.beforeUpdate(windowId, options, reason);
    return this.chrome.windows.update(windowId, options);
  }

  async createWindowFromTabs(
    bounds,
    savedTabs,
    kind,
    sessionCycle = null,
    recreationPath = "default_ph_create",
  ) {
    const validSaved = validSavedTabs(savedTabs, kind);
    let definitions = validSaved ?? (kind === "playhouse"
      ? defaultPlayhouseTabs(PLAYHOUSE_URL)
      : kind === "context" ? defaultAuxTabs() : defaultMiscTabs());
    if (kind === "playhouse") {
      const playhouseIndex = definitions.tabs.findIndex((tab) => isPlayhouseUrl(tab.url));
      if (playhouseIndex < 0) {
        definitions = {
          activeIndex: definitions.activeIndex + 1,
          tabs: [defaultPlayhouseTabs(PLAYHOUSE_URL).tabs[0], ...definitions.tabs],
        };
      } else {
        definitions = {
          ...definitions,
          tabs: definitions.tabs.map((tab, index) => ({
            ...tab,
            role: index === playhouseIndex ? "ph-primary" : null,
          })),
        };
      }
    }
    const eventPrefix = kind === "playhouse" ? "PH" : kind === "context" ? "AUX" : "MISC";
    if (kind === "playhouse") {
      const existingCandidateCount = await this.playhouseCandidateCount();
      this.recordPhSessionDiagnostic("PH_RESTORE_STARTED", {
        existing_candidate_count: existingCandidateCount,
        path: recreationPath,
        saved_snapshot_found: Boolean(validSaved),
        saved_tab_count: validSaved?.tabs.length ?? 0,
        snapshot: definitions,
      });
    }
    if (kind === "playhouse") this.phRestoreInProgress = true;
    else if (kind === "context") this.auxRestoreInProgress = true;
    else this.miscRestoreInProgress = true;
    this.creatingRestoreRole = kind;
    this.logger.info?.(`${eventPrefix}_RESTORE_START`, {
      ...diagnosticSession({ geometry: geometryFromBounds(bounds), tabs: definitions }),
      sessionCycle,
    });
    let window;
    let traceCallId = null;
    try {
      traceCallId = await this.windowTrace?.beforeCreate({
        bounds,
        kind,
        reason: `restore-${kind}-window`,
        urls: definitions.tabs.map((tab) => tab.url),
      });
      window = await this.chrome.windows.create({
        ...bounds,
        focused: false,
        type: "normal",
        url: definitions.tabs.map((tab) => tab.url),
      });
      this.windowTrace?.afterCreate(traceCallId, kind, window);
    } catch (error) {
      this.windowTrace?.createFailed(traceCallId, kind, error);
      if (kind === "playhouse") {
        this.recordPhSessionDiagnostic("PH_RESTORE_FINAL", {
          expectedSnapshot: definitions,
          final_tab_count: 0,
          first_failing_stage: "window_create",
          reason: "window_create_failed",
          success: false,
        });
      }
      if (kind === "playhouse") this.phRestoreInProgress = false;
      else if (kind === "context") this.auxRestoreInProgress = false;
      else this.miscRestoreInProgress = false;
      throw error;
    } finally {
      this.creatingRestoreRole = null;
    }
    if (!window?.id) {
      if (kind === "playhouse") {
        this.recordPhSessionDiagnostic("PH_RESTORE_FINAL", {
          expectedSnapshot: definitions,
          final_tab_count: 0,
          first_failing_stage: "window_create",
          reason: "window_id_missing",
          success: false,
        });
      }
      if (kind === "playhouse") this.phRestoreInProgress = false;
      else if (kind === "context") this.auxRestoreInProgress = false;
      else this.miscRestoreInProgress = false;
      throw new Error(`Chrome could not create the ${kind} window.`);
    }
    this.restoreWindowRoles.set(window.id, kind);
    this.systemGeometryWindowIds.add(window.id);
    this.logger.info?.(`${eventPrefix}_WINDOW_CREATED`, { windowId: window.id });
    this.logger.info?.(`${eventPrefix}_GEOMETRY_RESTORED`, {
      width: bounds.width,
      x: bounds.left,
    });
    const tabs = await this.tabsInWindow(window.id);
    if (tabs.length !== definitions.tabs.length) {
      if (kind === "playhouse") {
        this.recordPhSessionDiagnostic("PH_RESTORE_TAB_RESULT", {
          actualSnapshot: logicalTabState(tabs),
          created_count: tabs.length,
          expectedSnapshot: definitions,
          expected_count: definitions.tabs.length,
          failed_count: Math.max(0, definitions.tabs.length - tabs.length),
          reason: "tab_count_mismatch",
          reused_count: 0,
          success: false,
        });
        this.recordPhSessionDiagnostic("PH_RESTORE_FINAL", {
          actualSnapshot: logicalTabState(tabs),
          expectedSnapshot: definitions,
          final_tab_count: tabs.length,
          first_failing_stage: "tab_reconstruction",
          reason: "tab_count_mismatch",
          success: false,
        });
      }
      throw new Error(`Chrome could not restore the ${kind} tabs.`);
    }
    definitions.tabs.forEach((definition, index) => {
      this.logger.info?.(`${eventPrefix}_RESTORE_TAB_CREATED`, {
        index,
        role: definition.role,
        sessionCycle,
        tabId: tabs[index]?.id,
        hostname: hostnameForDiagnostic(definition.url),
        isPlayhouse: isPlayhouseUrl(definition.url),
        windowId: window.id,
      });
    });
    if (kind === "playhouse") {
      this.recordPhSessionDiagnostic("PH_RESTORE_TAB_RESULT", {
        actualSnapshot: logicalTabState(tabs),
        created_count: tabs.length,
        expectedSnapshot: definitions,
        expected_count: definitions.tabs.length,
        failed_count: 0,
        reason: "completed",
        reused_count: 0,
        success: true,
      });
      this.recordPhSessionDiagnostic("PH_RESTORE_ORDER_RESULT", {
        actualSnapshot: logicalTabState(tabs),
        attempted: true,
        expectedSnapshot: definitions,
        reason: tabs.every((tab, index) => tab.url === definitions.tabs[index]?.url)
          ? "completed"
          : "order_mismatch",
        success: tabs.every((tab, index) => tab.url === definitions.tabs[index]?.url),
      });
    }
    try {
      await Promise.all(definitions.tabs.flatMap((definition, index) => (
        definition.pinned ? [this.chrome.tabs.update(tabs[index].id, { pinned: true })] : []
      )));
    } catch (error) {
      if (kind === "playhouse") {
        this.recordPhSessionDiagnostic("PH_RESTORE_PIN_RESULT", {
          attempted: definitions.tabs.some((tab) => tab.pinned),
          expected_pinned_count: definitions.tabs.filter((tab) => tab.pinned).length,
          reason: "pin_update_failed",
          resulting_pinned_count: null,
          success: false,
        });
        this.recordPhSessionDiagnostic("PH_RESTORE_FINAL", {
          actualSnapshot: logicalTabState(tabs),
          expectedSnapshot: definitions,
          final_tab_count: tabs.length,
          first_failing_stage: "pin_restore",
          reason: "pin_update_failed",
          success: false,
        });
      }
      throw error;
    }
    const pinnedTabs = kind === "playhouse" ? await this.tabsInWindow(window.id) : tabs;
    if (kind === "playhouse") {
      const expectedPinned = definitions.tabs.filter((tab) => tab.pinned).length;
      const resultingPinned = pinnedTabs.filter((tab) => tab.pinned).length;
      this.recordPhSessionDiagnostic("PH_RESTORE_PIN_RESULT", {
        actualSnapshot: logicalTabState(pinnedTabs),
        attempted: expectedPinned > 0,
        expected_pinned_count: expectedPinned,
        reason: expectedPinned === resultingPinned ? "completed" : "pin_count_mismatch",
        resulting_pinned_count: resultingPinned,
        success: expectedPinned === resultingPinned,
      });
    }
    try {
      await this.chrome.tabs.update(tabs[definitions.activeIndex].id, { active: true });
    } catch (error) {
      if (kind === "playhouse") {
        this.recordPhSessionDiagnostic("PH_RESTORE_ACTIVE_RESULT", {
          attempted: true,
          expected_active_index: definitions.activeIndex,
          reason: "active_update_failed",
          resulting_active_index: null,
          success: false,
        });
        this.recordPhSessionDiagnostic("PH_RESTORE_FINAL", {
          actualSnapshot: logicalTabState(pinnedTabs),
          expectedSnapshot: definitions,
          final_tab_count: pinnedTabs.length,
          first_failing_stage: "active_restore",
          reason: "active_update_failed",
          success: false,
        });
      }
      throw error;
    }
    const activatedTabs = kind === "playhouse" ? await this.tabsInWindow(window.id) : tabs;
    if (kind === "playhouse") {
      const resultingActiveIndex = activatedTabs.findIndex((tab) => tab.active);
      this.recordPhSessionDiagnostic("PH_RESTORE_ACTIVE_RESULT", {
        actualSnapshot: logicalTabState(activatedTabs),
        attempted: true,
        expected_active_index: definitions.activeIndex,
        reason: resultingActiveIndex === definitions.activeIndex ? "completed" : "active_index_mismatch",
        resulting_active_index: resultingActiveIndex,
        success: resultingActiveIndex === definitions.activeIndex,
      });
    }
    const ids = roleTabIds(definitions, tabs);
    this.logger.info?.(`${eventPrefix}_TABS_RESTORED`, {
      count: tabs.length,
    });
    return {
      activeTab: tabs[definitions.activeIndex],
      expectedTabIds: tabs.map((tab) => tab.id),
      roleTabIds: ids,
      restored: true,
      tabState: definitions,
      window,
    };
  }

  async finalizeRestoredWindow(kind, restored, sessionCycle = null) {
    if (!restored?.restored) return null;
    const eventPrefix = kind === "playhouse" ? "PH" : kind === "context" ? "AUX" : "MISC";
    const windowId = restored.window.id;
    const state = await this.state();
    const { snapshot, tabs } = await this.snapshotWindow(kind, windowId, state);
    const expectedRoles = restored.tabState.tabs.map((tab) => tab.role ?? null);
    const actualRoles = snapshot?.tabs.map((tab) => tab.role ?? null);
    const actualTabIds = tabs.map((tab) => tab.id);
    const expectedActiveId = restored.expectedTabIds[restored.tabState.activeIndex];
    const actualActiveId = tabs.find((tab) => tab.active)?.id;
    const snapshotPresent = Boolean(snapshot);
    const orderMatch = JSON.stringify(actualTabIds) === JSON.stringify(restored.expectedTabIds);
    const roleMatch = JSON.stringify(actualRoles) === JSON.stringify(expectedRoles);
    const activeMatch = actualActiveId === expectedActiveId;
    const activeIndexMatch = snapshot?.activeIndex === restored.tabState.activeIndex;
    const urlFingerprintMatch = Boolean(snapshot) && snapshot.tabs.every(
      (tab, index) => tab.url === restored.tabState.tabs[index]?.url,
    );
    const pinMatch = Boolean(snapshot) && snapshot.tabs.every(
      (tab, index) => tab.pinned === restored.tabState.tabs[index]?.pinned,
    );
    const verificationSuccess = snapshotPresent && orderMatch && roleMatch && activeMatch;
    if (kind === "playhouse") {
      const verificationReason = !snapshotPresent
        ? "snapshot_missing"
        : !orderMatch ? "tab_order_mismatch"
          : !roleMatch ? "role_mismatch"
            : !activeMatch ? "active_tab_mismatch" : "completed";
      this.recordPhSessionDiagnostic("PH_RESTORE_VERIFY_RESULT", {
        active_index_match: activeIndexMatch,
        active_match: activeMatch,
        actualSnapshot: snapshot ?? logicalTabState(tabs),
        actual_count: tabs.length,
        expectedSnapshot: restored.tabState,
        expected_count: restored.tabState.tabs.length,
        order_match: orderMatch,
        pin_match: pinMatch,
        reason: verificationReason,
        role_match: roleMatch,
        success: verificationSuccess,
        url_fingerprint_match: urlFingerprintMatch,
      });
    }
    if (!verificationSuccess) {
      if (kind === "playhouse") {
        this.recordPhSessionDiagnostic("PH_RESTORE_FINAL", {
          actualSnapshot: snapshot ?? logicalTabState(tabs),
          expectedSnapshot: restored.tabState,
          final_tab_count: tabs.length,
          first_failing_stage: "verification",
          reason: !snapshotPresent
            ? "snapshot_missing"
            : !orderMatch ? "tab_order_mismatch"
              : !roleMatch ? "role_mismatch" : "active_tab_mismatch",
          success: false,
        });
      }
      throw new Error(`Chrome could not verify the restored ${kind} session.`);
    }
    this.logger.info?.(`${eventPrefix}_RESTORE_VERIFIED`, {
      activeIndex: snapshot.activeIndex,
      roles: actualRoles,
      sessionCycle,
      tabCount: snapshot.tabs.length,
      windowId,
    });

    if (kind === "playhouse") this.phRestoreInProgress = false;
    else if (kind === "context") this.auxRestoreInProgress = false;
    else this.miscRestoreInProgress = false;
    this.restoreWindowRoles.delete(windowId);
    const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
    const finalState = await this.updateState((current) => kind === "playhouse"
      ? {
          ...current,
          phSession: { ...current.phSession, tabs: snapshot },
          playhouseTabs: snapshot,
        }
      : kind === "context" ? {
          ...current,
          auxActiveTabId: activeTab.id,
          auxSession: { ...current.auxSession, tabs: snapshot },
          contextTabId: activeTab.id,
          contextTabs: snapshot,
          contextUrl: activeTab.url ?? current.contextUrl,
        }
        : {
          ...current,
          miscActiveTabId: activeTab.id,
          miscSession: { ...current.miscSession, tabs: snapshot },
          miscTabs: snapshot,
          miscWindowId: windowId,
        });
    this.logger.info?.(`${eventPrefix}_RESTORE_FINAL_SAVE`, {
      ...diagnosticSession(kind === "playhouse" ? finalState.phSession : finalState.auxSession),
      sessionCycle,
      windowId,
    });
    this.logger.info?.(`${eventPrefix}_RESTORE_COMPLETE`, {
      activeIndex: snapshot.activeIndex,
      sessionCycle,
      tabCount: snapshot.tabs.length,
      windowId,
    });
    if (kind === "playhouse") {
      this.recordPhSessionDiagnostic("PH_RESTORE_FINAL", {
        actualSnapshot: snapshot,
        expectedSnapshot: restored.tabState,
        final_tab_count: snapshot.tabs.length,
        reason: "completed",
        success: true,
      });
      await this.flushPhSessionDiagnostics();
    }
    this.settleSystemGeometry(windowId);
    return finalState;
  }

  cancelRestores() {
    this.phRestoreInProgress = false;
    this.auxRestoreInProgress = false;
    this.miscRestoreInProgress = false;
    this.creatingRestoreRole = null;
    this.restoreWindowRoles.clear();
    this.systemGeometryWindowIds.clear();
    for (const timer of this.systemGeometryTimers.values()) clearTimeout(timer);
    this.systemGeometryTimers.clear();
  }

  async snapshotWindow(kind, windowId, state) {
    const tabs = await this.tabsInWindow(windowId);
    const roleIds = kind === "context" ? state.auxRoleTabIds ?? {} : {};
    const primaryTabId = kind === "playhouse"
      ? tabs.find((tab) => tab.id === state.phPrimaryTabId && isPlayhouseUrl(tab.url))?.id ??
        tabs.find((tab) => isPlayhouseUrl(tab.url))?.id ?? null
      : null;
    const snapshot = snapshotTabs(
      tabs,
      roleIds,
      primaryTabId,
    );
    return { snapshot, tabs };
  }

  async findPlayhouse(prior, bounds, positionExisting = true, startup = {}) {
    this.windowTrace?.enter("playhouse", {
      reason: "find-or-create-playhouse",
      savedWindowId: prior.phWindowId,
      source: "workspace-controller",
    });
    try {
      await this.windowTrace?.discovery("PLAYHOUSE", prior.phWindowId);
      let window = await existingWindow(this.chrome, prior.phWindowId);
    let adoptedAtStartup = false;
    let tab = await existingTab(this.chrome, prior.phPrimaryTabId);
    if (!window || tab?.windowId !== window.id || !isPlayhouseUrl(tab?.url)) tab = null;
    if (!window && startup.allowColdStartPlayhouseAdoption) {
      const adopted = await waitForColdStartPlayhouse({
        candidateWindowIds: startup.coldStartCandidateWindowIds,
        chromeApi: this.chrome,
        excludedWindowIds: [prior.auxWindowId, prior.miscWindowId].filter(Number.isInteger),
        onEvent: (event, details) => this.windowTrace?.emit(
          "workspace-controller",
          event,
          details,
        ),
        timeoutMs: this.coldStartCandidateTimeoutMs,
      });
      if (adopted) {
        adoptedAtStartup = true;
        window = adopted.window;
        tab = adopted.tab;
        this.windowTrace?.emit("workspace-controller", "PH_GEOMETRY_ADOPT_TARGET", {
          actualLeft: storedBounds(window)?.left ?? null,
          actualTop: storedBounds(window)?.top ?? null,
          persistedLeft: storedGeometry(prior.phSession.geometry)?.left ?? null,
          reason: "cold-start-playhouse-adopted",
          targetLeft: bounds.left,
          targetTop: bounds.top,
          targetWidth: bounds.width,
        });
        this.windowTrace?.emit("workspace-controller", "PLAYHOUSE_ADOPTED", {
          phPrimaryTabId: tab.id,
          phWindowId: window.id,
        });
      }
    }
    if (!window) {
      const recreationPath = startup.source === "native hot corner"
        ? "hot_corner_recreate"
        : startup.allowColdStartPlayhouseAdoption ? "startup_recovery" : "default_ph_create";
      const restored = await this.createWindowFromTabs(
        bounds,
        prior.phSession.tabs,
        "playhouse",
        prior.sessionCycle ?? null,
        recreationPath,
      );
      return {
        tab: restored.roleTabIds["ph-primary"] ?
          await existingTab(this.chrome, restored.roleTabIds["ph-primary"]) : restored.activeTab,
        tabState: restored.tabState,
        restore: restored,
        window: restored.window,
      };
    } else {
      const existingCandidateCount = await this.playhouseCandidateCount();
      this.recordPhSessionDiagnostic("PH_RESTORE_STARTED", {
        existing_candidate_count: existingCandidateCount,
        path: adoptedAtStartup ? "startup_recovery" : "existing_window_adopted",
        saved_snapshot_found: Boolean(validSavedTabs(prior.phSession.tabs, "playhouse")),
        saved_tab_count: prior.phSession.tabs?.tabs?.length ?? 0,
        snapshot: prior.phSession.tabs,
      });
      await this.updateWindow(window.id, positionExisting
        ? { ...bounds, focused: false, state: "normal" }
        : { focused: false, state: "normal" }, "find-playhouse-existing");
      if (!tab) {
        tab = window.tabs?.find((candidate) => isPlayhouseUrl(candidate.url)) ??
          (await this.tabsInWindow(window.id)).find((candidate) => isPlayhouseUrl(candidate.url)) ?? null;
      }
      if (!tab) {
        tab = await this.chrome.tabs.create({ active: true, url: PLAYHOUSE_URL, windowId: window.id });
      }
    }
    if (!tab?.id) throw new Error("Chrome could not identify the PlayHouse tab.");
    const { snapshot } = await this.snapshotWindow("playhouse", window.id, {
      ...prior,
      playhouseTabId: tab.id,
    });
    return { restore: null, tab, tabState: snapshot ?? defaultPlayhouseTabs(PLAYHOUSE_URL), window };
    } finally {
      this.windowTrace?.exit("playhouse", {
        source: "workspace-controller",
      });
    }
  }

  async findContext(prior, bounds, positionExisting = true, updateExisting = true) {
    this.windowTrace?.enter("aux", {
      reason: "find-or-create-aux",
      savedWindowId: prior.auxWindowId,
      source: "workspace-controller",
    });
    try {
      await this.windowTrace?.discovery("AUX", prior.auxWindowId);
      const window = await existingWindow(this.chrome, prior.auxWindowId);
    let tab = await existingTab(this.chrome, prior.auxActiveTabId);
    if (!window || tab?.windowId !== window.id) tab = null;
    if (!window) {
      const restored = await this.createWindowFromTabs(
        bounds,
        prior.auxSession.tabs,
        "context",
        prior.sessionCycle ?? null,
      );
      return {
        roleTabIds: restored.roleTabIds,
        tab: restored.activeTab,
        tabState: restored.tabState,
        restore: restored,
        window: restored.window,
      };
    } else {
      if (updateExisting) {
        await this.updateWindow(window.id, positionExisting
          ? { ...bounds, focused: false, state: "normal" }
          : { focused: false, state: "normal" }, "find-aux-existing");
      }
      const repaired = await this.repairAuxTabs(prior, window, bounds);
      const roles = repaired?.auxRoleTabIds ?? { ...(prior.auxRoleTabIds ?? {}) };
      const tabs = await this.tabsInWindow(window.id);
      tab = tabs.find((candidate) => candidate.active) ?? tabs[0] ?? null;
      const snapshot = repaired?.auxSnapshot ?? snapshotTabs(tabs, roles);
      if (!tab?.id || !snapshot) throw new Error("Chrome could not identify the context tabs.");
      return {
        miscRepair: repaired?.misc ? repaired : null,
        restore: null,
        roleTabIds: roles,
        tab,
        tabState: snapshot,
        window,
      };
    }
    } finally {
      this.windowTrace?.exit("aux", {
        source: "workspace-controller",
      });
    }
  }

  async findMisc(prior, bounds, positionExisting = true) {
    let window = await existingWindow(this.chrome, prior.miscWindowId);
    if (!window && prior.miscSession?.tabs) {
      const windows = await this.chrome.windows.getAll({ populate: true });
      window = windows.find((candidate) => (
        candidate.id !== prior.phWindowId &&
        candidate.id !== prior.auxWindowId &&
        orderedUrlsMatch(candidate.tabs ?? [], prior.miscSession.tabs)
      )) ?? null;
    }
    if (!window) {
      const restored = await this.createWindowFromTabs(
        bounds,
        prior.miscSession?.tabs,
        "misc",
        prior.sessionCycle ?? null,
      );
      return {
        tab: restored.activeTab,
        tabState: restored.tabState,
        restore: restored,
        window: restored.window,
      };
    }
    if (positionExisting) {
      window = await this.updateWindow(window.id, {
        ...bounds,
        focused: false,
        state: "normal",
      }, "find-misc-existing");
    }
    const tabs = await this.tabsInWindow(window.id);
    const tab = tabs.find((candidate) => candidate.active) ??
      tabs.find((candidate) => candidate.id === prior.miscActiveTabId) ?? tabs[0] ?? null;
    const snapshot = snapshotTabs(tabs);
    if (!tab?.id || !snapshot) throw new Error("Chrome could not identify the Misc tabs.");
    return { restore: null, tab, tabState: snapshot, window };
  }

  async repairAuxTabs(prior, auxWindow, bounds, { revealMisc = false } = {}) {
    if (!auxWindow?.id || this.auxRepairInProgress) return null;
    this.auxRepairInProgress = true;
    try {
      const roleIds = { ...(prior.auxRoleTabIds ?? {}) };
      const claimed = new Set();
      for (const role of AUX_HOT_TAB_ORDER) {
        let tab = await existingTab(this.chrome, roleIds[role]);
        if (tab && tab.windowId !== auxWindow.id) {
          try {
            tab = await this.chrome.tabs.move(tab.id, { index: -1, windowId: auxWindow.id });
          } catch {
            tab = null;
          }
        }
        if (!tab || tab.windowId !== auxWindow.id || claimed.has(tab.id)) {
          const candidates = await this.tabsInWindow(auxWindow.id);
          const savedRoleUrl = prior.auxSession?.tabs?.tabs.find((saved) => saved.role === role)?.url ??
            AUX_ROLE_URLS[role];
          tab = candidates.find((candidate) => (
            !claimed.has(candidate.id) && (role === HOT_TAB_ROLES.url
              ? candidate.url === savedRoleUrl
              : auxRoleForUrl(candidate.url) === role)
          )) ?? null;
        }
        if (!tab) {
          tab = await this.chrome.tabs.create({
            active: false,
            url: AUX_ROLE_URLS[role],
            windowId: auxWindow.id,
          });
        }
        roleIds[role] = tab.id;
        claimed.add(tab.id);
      }

      const extras = (await this.tabsInWindow(auxWindow.id))
        .filter((tab) => !claimed.has(tab.id));
      let misc = null;
      let movedActiveTab = null;
      if (extras.length) {
        misc = await this.findMisc(prior, bounds, false);
        for (const extra of extras) {
          const moved = await this.chrome.tabs.move(extra.id, {
            index: -1,
            windowId: misc.window.id,
          });
          if (extra.active || !movedActiveTab) movedActiveTab = moved;
        }
      }

      for (const [index, role] of AUX_HOT_TAB_ORDER.entries()) {
        await this.chrome.tabs.update(roleIds[role], { pinned: false });
        await this.chrome.tabs.move(roleIds[role], { index });
      }
      const preferredActiveId = Object.values(roleIds).includes(prior.auxActiveTabId)
        ? prior.auxActiveTabId
        : roleIds.calendar;
      await this.chrome.tabs.update(preferredActiveId, { active: true });
      const finalAuxTabs = await this.tabsInWindow(auxWindow.id);
      const auxSnapshot = snapshotTabs(finalAuxTabs, roleIds);
      if (!auxSnapshot) throw new Error("Chrome could not repair the Aux Hot Tabs.");

      let miscSnapshot = prior.miscSession?.tabs ?? null;
      if (misc) {
        if (revealMisc && movedActiveTab?.id) {
          await this.chrome.tabs.update(movedActiveTab.id, { active: true });
        }
        miscSnapshot = snapshotTabs(await this.tabsInWindow(misc.window.id));
      }
      return {
        auxActiveTabId: preferredActiveId,
        auxRoleTabIds: roleIds,
        auxSnapshot,
        misc,
        miscActiveTabId: revealMisc ? movedActiveTab?.id ?? misc?.tab?.id : prior.miscActiveTabId,
        miscSnapshot,
        revealMisc: revealMisc && Boolean(misc),
      };
    } finally {
      this.auxRepairInProgress = false;
    }
  }

  async switchRightSurface(surface, workArea = null) {
    const requestedSurface = normalizedRightSurface(surface);
    let prior = await this.state();
    const activeWorkArea = validWorkArea(workArea) ? workArea : prior.workArea;
    if (!validWorkArea(activeWorkArea)) {
      throw new Error("A valid monitor work area is required to switch Carnival surfaces.");
    }
    const layout = canonicalWorkspaceLayout(prior, activeWorkArea);
    const outgoingId = selectedRightWindowId(prior);
    const outgoingWindow = await existingWindow(this.chrome, outgoingId);
    const slotBounds = actualRestingBounds(outgoingWindow, activeWorkArea) ?? layout.context;
    if (outgoingWindow) {
      await this.rememberWorkspaceTabs(outgoingWindow.id, "right-surface-switch");
      prior = await this.state();
    }

    const target = requestedSurface === "aux"
      ? await this.findContext(prior, slotBounds, true)
      : await this.findMisc(prior, slotBounds, true);
    if (outgoingWindow && outgoingWindow.id !== target.window.id) {
      await this.updateWindow(outgoingWindow.id, {
        focused: false,
        state: "minimized",
      }, `hide-${prior.rightSurface}-for-${requestedSurface}`);
    }
    await this.updateWindow(target.window.id, {
      ...slotBounds,
      focused: true,
      state: "normal",
    }, `show-${requestedSurface}-surface`);

    const saved = await this.save({
      ...prior,
      ...(requestedSurface === "aux" ? {
        auxActiveTabId: target.tab.id,
        auxRoleTabIds: target.roleTabIds,
        auxSession: { geometry: geometryFromBounds(slotBounds), tabs: target.tabState },
        auxWindowId: target.window.id,
        contextRoleTabIds: target.roleTabIds,
        contextTabId: target.tab.id,
        contextTabs: target.tabState,
        contextUrl: target.tab.url ?? prior.contextUrl ?? DEFAULT_CONTEXT_URL,
        contextWindowId: target.window.id,
        ...(target.miscRepair ? {
          miscActiveTabId: target.miscRepair.miscActiveTabId,
          miscSession: { ...prior.miscSession, tabs: target.miscRepair.miscSnapshot },
          miscTabs: target.miscRepair.miscSnapshot,
          miscWindowId: target.miscRepair.misc.window.id,
        } : {}),
      } : {
        miscActiveTabId: target.tab.id,
        miscSession: { geometry: geometryFromBounds(slotBounds), tabs: target.tabState },
        miscTabs: target.tabState,
        miscWindowId: target.window.id,
      }),
      contextBounds: slotBounds,
      rightSlotGeometry: geometryFromBounds(slotBounds),
      rightSurface: requestedSurface,
      workArea: activeWorkArea,
    });
    if (target.restore) {
      await this.finalizeRestoredWindow(
        requestedSurface === "aux" ? "context" : "misc",
        target.restore,
        prior.sessionCycle ?? null,
      );
    }
    return saved;
  }

  async toggleRightSurface(workArea = null) {
    const state = await this.state();
    return this.switchRightSurface(state.rightSurface === "misc" ? "aux" : "misc", workArea);
  }

  async reconcileAuxTabs(windowId, { revealMisc = false } = {}) {
    if (this.auxRepairInProgress || this.isRestoreInProgress(windowId)) return null;
    const prior = await this.state();
    if (windowId !== prior.auxWindowId || !validWorkArea(prior.workArea)) return null;
    const auxWindow = await existingWindow(this.chrome, windowId);
    if (!auxWindow) return null;
    const layout = canonicalWorkspaceLayout(prior, prior.workArea);
    const repaired = await this.repairAuxTabs(prior, auxWindow, layout.context, { revealMisc });
    if (!repaired) return null;
    await this.save({
      ...prior,
      auxActiveTabId: repaired.auxActiveTabId,
      auxRoleTabIds: repaired.auxRoleTabIds,
      auxSession: { ...prior.auxSession, tabs: repaired.auxSnapshot },
      contextRoleTabIds: repaired.auxRoleTabIds,
      contextTabId: repaired.auxActiveTabId,
      contextTabs: repaired.auxSnapshot,
      ...(repaired.misc ? {
        miscActiveTabId: repaired.miscActiveTabId,
        miscSession: { ...prior.miscSession, tabs: repaired.miscSnapshot },
        miscTabs: repaired.miscSnapshot,
        miscWindowId: repaired.misc.window.id,
      } : {}),
    });
    if (repaired.revealMisc) {
      const state = await this.switchRightSurface("misc", prior.workArea);
      if (repaired.miscActiveTabId) {
        await this.chrome.tabs.update(repaired.miscActiveTabId, { active: true });
        await this.rememberWorkspaceTabs(state.miscWindowId, "aux-extra-tab-handoff");
      }
      return this.state();
    }
    return this.state();
  }

  async animate(playhouseWindowId, contextWindowId, current, layout, workArea, action, durationMs) {
    const anchoredPlayhouse = getAnchoredPlayhouseGeometry(workArea, layout.playhouse.width);
    if (layout.playhouse.left !== anchoredPlayhouse.left || layout.playhouse.top !== anchoredPlayhouse.top) {
      this.windowTrace?.emit("workspace-controller", "PH_ANCHOR_INVARIANT_VIOLATION", {
        actualLeft: current.playhouse.left,
        actualTop: current.playhouse.top,
        reason: "animation-request-normalized",
        targetLeft: layout.playhouse.left,
        targetTop: layout.playhouse.top,
        targetWidth: layout.playhouse.width,
        workAreaLeft: workArea.left,
        workAreaTop: workArea.top,
      });
    }
    const anchoredLayout = { ...layout, playhouse: anchoredPlayhouse };
    const retractedLayout = canonicalRetractedWorkspaceLayout(anchoredLayout, workArea);
    const from = action === "open" ? retractedLayout : anchoredLayout;
    const to = action === "open" ? anchoredLayout : retractedLayout;
    this.windowTrace?.emit("workspace-controller", "WORKSPACE_ANIMATION_START", {
      action,
      auxActualStartLeft: current.context.left,
      auxTargetLeft: to.context.left,
      drawerState: action === "open" ? "opening" : "retracting",
      phActualStartLeft: current.playhouse.left,
      phTargetLeft: to.playhouse.left,
    });
    this.movingWindowIds.add(playhouseWindowId);
    this.movingWindowIds.add(contextWindowId);
    try {
      if (this.nativeAnimate && await this.nativeAnimate({
        action,
        contextWindowId,
        context: {
          current: current.context,
          from: from.context,
          to: to.context,
        },
        durationMs,
        easing: action === "retract" ? "in" : "out",
        playhouseWindowId,
        playhouse: {
          current: current.playhouse,
          from: from.playhouse,
          to: to.playhouse,
        },
        workArea,
      })) {
        this.windowTrace?.emit("workspace-controller", "WORKSPACE_ANIMATION_COMPLETE", {
          action,
          auxTargetLeft: to.context.left,
          phTargetLeft: to.playhouse.left,
        });
        return true;
      }
      this.logger.warn("Carnival native animation unavailable; using visible fallback");
      await Promise.all([
        this.updateWindow(playhouseWindowId,
          { ...anchoredLayout.playhouse, focused: false, state: "normal" }, "animation-visible-fallback-playhouse"),
        this.updateWindow(contextWindowId,
          { ...anchoredLayout.context, focused: false, state: "normal" }, "animation-visible-fallback-aux"),
      ]);
      if (action === "retract") {
        this.windowTrace?.emit("workspace-controller", "WORKSPACE_ANIMATION_FAILED", {
          action,
          auxTargetLeft: to.context.left,
          phTargetLeft: to.playhouse.left,
        });
      }
      this.windowTrace?.emit("workspace-controller", "WORKSPACE_PAIR_RESTORED", {
        action,
        auxTargetLeft: anchoredLayout.context.left,
        phTargetLeft: anchoredLayout.playhouse.left,
        restoredState: "open",
      });
      return action === "open";
    } finally {
      this.movingWindowIds.delete(playhouseWindowId);
      this.movingWindowIds.delete(contextWindowId);
    }
  }

  async summon(workArea, monitorId = null, startup = {}) {
    this.transitioning = true;
    try {
      return await this.summonDrawer(workArea, monitorId, startup);
    } catch (error) {
      this.cancelRestores();
      await this.flushPhSessionDiagnostics();
      throw error;
    } finally {
      this.transitioning = false;
    }
  }

  async activate() {
    const state = await this.state();
    if (state.drawerState !== "open") return state;
    const [playhouseWindow, contextWindow] = await Promise.all([
      existingWindow(this.chrome, state.phWindowId),
      existingWindow(this.chrome, selectedRightWindowId(state)),
    ]);
    if (!playhouseWindow || !contextWindow) return state;
    const bounds = {
      context: currentBounds(contextWindow, state.contextBounds),
      playhouse: currentBounds(playhouseWindow, state.playhouseBounds),
    };
    if (this.nativeActivate && await this.nativeActivate(bounds)) return state;
    await this.updateWindow(contextWindow.id, { focused: true }, "activate-aux");
    await this.updateWindow(playhouseWindow.id, { focused: true }, "activate-playhouse");
    return state;
  }

  async reconcileWorkspaceState(workArea) {
    const state = await this.state();
    const [playhouseWindow, contextWindow, playhouseTab, contextTab] = await Promise.all([
      existingWindow(this.chrome, state.phWindowId),
      existingWindow(this.chrome, selectedRightWindowId(state)),
      existingTab(this.chrome, state.phPrimaryTabId),
      existingTab(this.chrome, state.rightSurface === "misc"
        ? state.miscActiveTabId
        : state.auxActiveTabId),
    ]);
    const playhouseIdentityValid = Boolean(playhouseWindow);
    const contextIdentityValid = Boolean(contextWindow);
    const playhouseTabValid = Boolean(playhouseTab && playhouseTab.windowId === playhouseWindow?.id);
    const contextTabValid = Boolean(contextTab && contextTab.windowId === contextWindow?.id);
    const playhouseVisible = playhouseIdentityValid && hasVisibleIntersection(playhouseWindow, workArea);
    const contextVisible = contextIdentityValid && hasVisibleIntersection(contextWindow, workArea);
    if (playhouseVisible && contextVisible) {
      return { actuallyOpen: true, state };
    }
    if (state.drawerState !== "open" && state.drawerState !== "opening") {
      return { actuallyOpen: false, state };
    }
    this.logger.info?.("Carnival: actual workspace not visible; reconciling");
    const reconciled = {
      ...state,
      ...(state.rightSurface === "misc" ? {
        miscActiveTabId: contextTabValid ? state.miscActiveTabId : null,
        miscWindowId: contextIdentityValid ? state.miscWindowId : null,
      } : {
        auxActiveTabId: contextTabValid ? state.auxActiveTabId : null,
        auxWindowId: contextIdentityValid ? state.auxWindowId : null,
      }),
      drawerState: "retracted",
      phPrimaryTabId: playhouseTabValid ? state.phPrimaryTabId : null,
      phWindowId: playhouseIdentityValid ? state.phWindowId : null,
    };
    const saved = await this.save(reconciled);
    return { actuallyOpen: false, state: saved };
  }

  async handleWindowClosed(windowId) {
    let closedRole = null;
    const result = await this.updateState((state) => {
      const phClosed = windowId === state.phWindowId;
      const auxClosed = windowId === state.auxWindowId;
      const miscClosed = windowId === state.miscWindowId;
      if (!phClosed && !auxClosed && !miscClosed) return null;
      closedRole = phClosed ? "ph" : auxClosed ? "aux" : "misc";
      const sessionCycle = state.sessionCycle ?? newSessionCycleId();
      if (phClosed) {
        this.recordPhSessionDiagnostic("PH_WINDOW_REMOVED", {
          reason: "window-closing",
          saved_snapshot_existed: Boolean(validSavedTabs(state.phSession.tabs, "playhouse")),
          saved_tab_count: state.phSession.tabs?.tabs?.length ?? 0,
          session_cycle: sessionCycle,
          snapshot: state.phSession.tabs,
        });
      }
      this.logger.info?.("WINDOW_CLOSE_STARTED", {
        role: closedRole,
        session: diagnosticSession(phClosed
          ? state.phSession
          : auxClosed ? state.auxSession : state.miscSession),
        sessionCycle,
        windowId,
      });
      const phWindowId = phClosed ? null : state.phWindowId;
      const auxWindowId = auxClosed ? null : state.auxWindowId;
      const miscWindowId = miscClosed ? null : state.miscWindowId;
      const rightWindowId = state.rightSurface === "misc" ? miscWindowId : auxWindowId;
      return {
        ...state,
        auxActiveTabId: auxClosed ? null : state.auxActiveTabId,
        auxRoleTabIds: auxClosed ? {} : state.auxRoleTabIds,
        auxWindowId,
        drawerState: phWindowId && rightWindowId
          ? state.drawerState
          : phWindowId || rightWindowId ? "degraded" : "retracted",
        miscActiveTabId: miscClosed ? null : state.miscActiveTabId,
        miscWindowId,
        phPrimaryTabId: phClosed ? null : state.phPrimaryTabId,
        phWindowId,
        lastSessionCycle: sessionCycle,
        sessionCycle,
      };
    });
    if (result) {
      this.logger.info?.("WINDOW_CLOSE_COMPLETE", {
        auxWindowId: result.auxWindowId,
        phWindowId: result.phWindowId,
        role: closedRole,
        sessionCycle: result.sessionCycle,
        windowId,
      });
    }
    await this.flushPhSessionDiagnostics();
    return result;
  }

  async summonDrawer(workArea, monitorId = null, startup = {}) {
    const prior = await this.state();
    const layout = canonicalWorkspaceLayout(prior, workArea);
    const savedPlayhouse = storedGeometry(prior.phSession.geometry);
    const savedContext = storedGeometry(prior.rightSlotGeometry) ??
      storedGeometry(selectedRightSession(prior)?.geometry);
    if (!savedPlayhouse || !savedContext) {
      this.logger.info?.("Carnival: using default workspace bounds");
    } else if (layout.playhouse.left === savedPlayhouse.left && layout.playhouse.width === savedPlayhouse.width &&
      layout.context.left === savedContext.left && layout.context.width === savedContext.width) {
      this.logger.info?.("Carnival: restoring saved visible workspace bounds");
    } else {
      this.logger.info?.("Carnival: normalizing saved bounds for new monitor");
    }
    const [knownPlayhouse, knownContext] = await Promise.all([
      existingWindow(this.chrome, prior.phWindowId),
      existingWindow(this.chrome, selectedRightWindowId(prior)),
    ]);
    const actualLeft = storedBounds(knownPlayhouse)?.left ?? null;
    for (const [event, reason] of [
      ["PH_GEOMETRY_PERSISTED", "summon"],
      ["PH_GEOMETRY_TARGET", "canonical-workspace-layout"],
      ["PH_GEOMETRY_SUMMON_TARGET", "summon"],
    ]) {
      this.windowTrace?.emit("workspace-controller", event, {
        actualLeft,
        persistedLeft: savedPlayhouse?.left ?? null,
        reason,
        targetLeft: layout.playhouse.left,
      });
    }
    const repairingOneSide = Boolean(knownPlayhouse) !== Boolean(knownContext);
    const shouldAnimate = !repairingOneSide &&
      (prior.drawerState !== "open" || !knownPlayhouse || !knownContext);
    const positionExisting = !shouldAnimate || !this.nativeAnimate;
    const playhouse = await this.findPlayhouse(
      prior,
      layout.playhouse,
      positionExisting && !(repairingOneSide && knownPlayhouse),
      startup,
    );
    const context = prior.rightSurface === "misc"
      ? await this.findMisc(
        prior,
        layout.context,
        positionExisting && !(repairingOneSide && knownContext),
      )
      : await this.findContext(
        prior,
        layout.context,
        positionExisting && !(repairingOneSide && knownContext),
      );
    const current = {
      context: currentBounds(context.window, layout.context),
      playhouse: currentBounds(playhouse.window, layout.playhouse),
    };
    const actualPlayhouse = storedBounds(playhouse.window);
    const anchorBeforeOpen = !shouldAnimate || !knownPlayhouse;
    if (anchorBeforeOpen &&
      (actualPlayhouse?.left !== layout.playhouse.left || actualPlayhouse?.top !== layout.playhouse.top)) {
      this.windowTrace?.emit("workspace-controller", "PH_ANCHOR_CORRECTED", {
        actualLeft: actualPlayhouse?.left ?? null,
        actualTop: actualPlayhouse?.top ?? null,
        reason: startup.allowColdStartPlayhouseAdoption ? "cold-start-adoption" : "summon",
        targetLeft: layout.playhouse.left,
        targetTop: layout.playhouse.top,
        targetWidth: layout.playhouse.width,
        workAreaLeft: workArea.left,
        workAreaTop: workArea.top,
      });
    }
    if (anchorBeforeOpen && !compareAnimationLanding(actualPlayhouse, layout.playhouse).landed) {
      await this.updateWindow(playhouse.window.id,
        { ...layout.playhouse, focused: false, state: "normal" }, "anchor-playhouse-before-summon");
      current.playhouse = layout.playhouse;
    }
    const inactiveRightWindow = await existingWindow(
      this.chrome,
      prior.rightSurface === "misc" ? prior.auxWindowId : prior.miscWindowId,
    );
    if (inactiveRightWindow && inactiveRightWindow.id !== context.window.id) {
      await this.updateWindow(inactiveRightWindow.id, {
        focused: false,
        state: "minimized",
      }, "hide-inactive-right-surface-before-summon");
    }
    const selectedRightState = prior.rightSurface === "misc" ? {
      miscActiveTabId: context.tab.id,
      miscSession: {
        geometry: geometryFromBounds(layout.context),
        tabs: context.tabState,
      },
      miscTabs: context.tabState,
      miscWindowId: context.window.id,
    } : {
      ...prior,
      auxActiveTabId: context.tab.id,
      auxRoleTabIds: context.roleTabIds,
      auxSession: {
        geometry: geometryFromBounds(layout.context),
        tabs: context.tabState,
      },
      auxWindowId: context.window.id,
      contextBounds: layout.context,
      contextRoleTabIds: context.roleTabIds,
      contextTabId: context.tab.id,
      contextTabs: context.tabState,
      contextUrl: context.tab.url ?? prior.contextUrl ?? DEFAULT_CONTEXT_URL,
      contextWindowId: context.window.id,
      ...(context.miscRepair ? {
        miscActiveTabId: context.miscRepair.miscActiveTabId,
        miscSession: { ...prior.miscSession, tabs: context.miscRepair.miscSnapshot },
        miscTabs: context.miscRepair.miscSnapshot,
        miscWindowId: context.miscRepair.misc.window.id,
      } : {}),
    };
    const openingState = {
      ...prior,
      ...selectedRightState,
      contextBounds: layout.context,
      drawerState: shouldAnimate ? "opening" : "open",
      layoutVersion: LAYOUT_VERSION,
      monitorId,
      phPrimaryTabId: playhouse.tab.id,
      phSession: {
        geometry: geometryFromBounds(layout.playhouse),
        tabs: playhouse.tabState,
      },
      phWindowId: playhouse.window.id,
      playhouseBounds: layout.playhouse,
      playhouseTabId: playhouse.tab.id,
      playhouseTabs: playhouse.tabState,
      playhouseWindowId: playhouse.window.id,
      rightSlotGeometry: geometryFromBounds(layout.context),
      workArea,
    };
    await this.save(openingState);
    if (shouldAnimate) {
      await this.animate(
        playhouse.window.id,
        context.window.id,
        current,
        layout,
        workArea,
        "open",
        OPEN_ANIMATION_MS,
      );
    }
    const openState = {
      ...openingState,
      drawerState: "open",
      lastSessionCycle: prior.sessionCycle ?? prior.lastSessionCycle ?? null,
      sessionCycle: null,
    };
    await this.save(openState);
    await this.updateWindow(context.window.id, { focused: true }, `summon-${prior.rightSurface}`);
    await this.updateWindow(playhouse.window.id, { focused: true }, "summon-playhouse");
    await this.finalizeRestoredWindow("playhouse", playhouse.restore, prior.sessionCycle ?? null);
    await this.finalizeRestoredWindow(
      prior.rightSurface === "misc" ? "misc" : "context",
      context.restore,
      prior.sessionCycle ?? null,
    );
    return this.state();
  }

  async retract() {
    this.transitioning = true;
    try {
      return await this.retractDrawer();
    } finally {
      this.transitioning = false;
    }
  }

  async retractDrawer() {
    const state = await this.state();
    if (state.drawerState !== "open" || !validWorkArea(state.workArea)) return state;
    const playhouseWindow = await existingWindow(this.chrome, state.phWindowId);
    const contextWindow = await existingWindow(this.chrome, selectedRightWindowId(state));
    if (!playhouseWindow || !contextWindow) {
      const retracted = { ...state, drawerState: "retracted" };
      await this.save(retracted);
      return retracted;
    }
    const persistedLayout = canonicalWorkspaceLayout(state, state.workArea);
    const playhouseActual = storedBounds(playhouseWindow);
    const playhouseVisible = playhouseActual
      ? getAnchoredPlayhouseGeometry(state.workArea, playhouseActual.width)
      : null;
    const contextVisible = actualRestingBounds(contextWindow, state.workArea);
    const layout = {
      context: contextVisible ?? persistedLayout.context,
      playhouse: playhouseVisible ?? persistedLayout.playhouse,
    };
    if (playhouseActual?.left !== layout.playhouse.left || playhouseActual?.top !== layout.playhouse.top) {
      this.windowTrace?.emit("workspace-controller", "PH_ANCHOR_CORRECTED", {
        actualLeft: playhouseActual?.left ?? null,
        actualTop: playhouseActual?.top ?? null,
        reason: "before-retract",
        targetLeft: layout.playhouse.left,
        targetTop: layout.playhouse.top,
        targetWidth: layout.playhouse.width,
        workAreaLeft: state.workArea.left,
        workAreaTop: state.workArea.top,
      });
    }
    if (!compareAnimationLanding(playhouseActual, layout.playhouse).landed) {
      await this.updateWindow(playhouseWindow.id,
        { ...layout.playhouse, focused: false, state: "normal" }, "anchor-playhouse-before-retract");
    }
    const visibleState = {
      ...state,
      ...(state.rightSurface === "misc" ? {
        miscSession: { ...state.miscSession, geometry: geometryFromBounds(layout.context) },
      } : {
        auxSession: { ...state.auxSession, geometry: geometryFromBounds(layout.context) },
      }),
      contextBounds: layout.context,
      phSession: { ...state.phSession, geometry: geometryFromBounds(layout.playhouse) },
      playhouseBounds: layout.playhouse,
      rightSlotGeometry: geometryFromBounds(layout.context),
    };
    this.windowTrace?.emit("workspace-controller", "PH_GEOMETRY_ACTUAL", {
      actualLeft: storedBounds(playhouseWindow)?.left ?? null,
      persistedLeft: storedGeometry(state.phSession.geometry)?.left ?? null,
      reason: "before-retract",
      targetLeft: layout.playhouse.left,
    });
    this.windowTrace?.emit("workspace-controller", "PH_GEOMETRY_RETRACT_TARGET", {
      actualLeft: storedBounds(playhouseWindow)?.left ?? null,
      persistedLeft: storedGeometry(state.phSession.geometry)?.left ?? null,
      reason: playhouseVisible ? "settled-visible-playhouse" : "persisted-canonical-fallback",
      targetLeft: layout.playhouse.left,
    });
    await this.save({ ...visibleState, drawerState: "retracting" });
    const current = {
      context: currentBounds(contextWindow, layout.context),
      playhouse: currentBounds(playhouseWindow, layout.playhouse),
    };
    const retractedSuccessfully = await this.animate(
      playhouseWindow.id,
      contextWindow.id,
      current,
      layout,
      state.workArea,
      "retract",
      CLOSE_ANIMATION_MS,
    );
    if (!retractedSuccessfully) {
      const open = { ...visibleState, drawerState: "open" };
      await this.save(open);
      return open;
    }
    const retracted = { ...visibleState, drawerState: "retracted" };
    await this.save(retracted);
    return retracted;
  }

  async openCarnivalContext(url, workArea, _monitorId = null, requestedRole = null) {
    if (!isAllowedContextUrl(url)) throw new Error("Carnival context URLs must use HTTP or HTTPS.");
    if (!validWorkArea(workArea)) throw new Error("A valid monitor work area is required.");
    const role = requestedRole ?? auxRoleForUrl(url);
    if (role !== "calendar" && role !== "contacts" && role !== "drive" && role !== "gmail" &&
      role !== "misc" && role !== "slack") {
      throw new Error("Carnival context navigation requires a Calendar, Contacts, Drive, Gmail, Slack, or Misc role.");
    }
    const hotTabRole = role === "drive" ? HOT_TAB_ROLES.drive : role;

    this.logger.info?.("Carnival: resolving Aux context window");
    await this.switchRightSurface("aux", workArea);
    const prior = await this.state();
    const layout = canonicalWorkspaceLayout(prior, workArea);
    let contextWindow = await existingWindow(this.chrome, prior.auxWindowId);
    if (!contextWindow) {
      this.logger.warn?.("AUX_ROUTE_SKIPPED", { reason: "existing-aux-window-missing" });
      throw new Error("Carnival Aux must already be open before PlayHouse can route content.");
    }
    const restoreContext = !hasVisibleIntersection(contextWindow, workArea);
    if (restoreContext) {
      contextWindow = await this.updateWindow(contextWindow.id, {
        ...layout.context,
        focused: false,
        state: "normal",
      }, "show-existing-aux-for-route");
      this.logger.info?.("AUX_ROUTE_VISIBILITY_PREPARED", {
        reason: "existing-aux-was-not-visible",
        windowId: contextWindow.id,
      });
    }
    const contextTabsBeforeRoute = await this.tabsInWindow(contextWindow.id);
    if (!contextTabsBeforeRoute.length) throw new Error("Chrome could not identify the existing Aux tabs.");
    const roleIds = { ...(prior.auxRoleTabIds ?? {}) };
    const contactsTabs = hotTabRole === "contacts"
      ? (await this.tabsInWindow(contextWindow.id)).filter((tab) => isGoogleContactsUrl(tab.url))
      : [];
    const slackTabs = hotTabRole === "slack"
      ? (await this.tabsInWindow(contextWindow.id)).filter((tab) => auxRoleForUrl(tab.url) === "slack")
      : [];
    let roleTab = hotTabRole === "contacts"
      ? contactsTabs.find((tab) => tab.active) ?? contactsTabs[0] ?? null
      : await existingTab(this.chrome, roleIds[hotTabRole]);
    if (hotTabRole === "slack" && !roleTab) {
      roleTab = slackTabs.find((tab) => tab.active) ?? slackTabs[0] ?? null;
    }
    if (!roleTab || roleTab.windowId !== contextWindow.id) {
      roleTab = await this.chrome.tabs.create({ active: true, url, windowId: contextWindow.id });
      this.logger.info?.("AUX_ROLE_TAB_CREATED", { role: hotTabRole, tabId: roleTab.id });
    } else {
      this.logger.info?.("AUX_ROLE_TAB_FOUND", { role: hotTabRole, tabId: roleTab.id });
      await this.chrome.tabs.update(roleTab.id, { active: true, url });
    }
    roleIds[hotTabRole] = roleTab.id;
    this.logger.info?.("AUX_ROLE_TAB_ACTIVATED", { role: hotTabRole, tabId: roleTab.id });
    const navigatedEvent = role === "gmail"
      ? "GMAIL_ROLE_NAVIGATED"
      : role === "calendar" ? "CALENDAR_ROLE_NAVIGATED"
      : role === "contacts"
        ? "CONTACTS_ROLE_NAVIGATED"
        : role === "slack" ? "SLACK_ROLE_NAVIGATED"
          : role === "drive" ? "DRIVE_ROLE_NAVIGATED" : "MISC_ROLE_NAVIGATED";
    this.logger.info?.(navigatedEvent, {
      host: new URL(url).hostname,
      path: new URL(url).pathname,
      tabId: roleTab.id,
    });
    if (Object.values(HOT_TAB_ROLES).includes(hotTabRole)) {
      this.logger.info?.("HOT_TAB_NAVIGATED", {
        host: new URL(url).hostname,
        role: hotTabRole,
        tabId: roleTab.id,
      });
    }
    const tabs = await this.tabsInWindow(contextWindow.id);
    const contextTabs = snapshotTabs(tabs, roleIds);
    await this.save({
      ...prior,
      auxActiveTabId: roleTab.id,
      auxRoleTabIds: roleIds,
      auxSession: {
        ...prior.auxSession,
        tabs: contextTabs,
      },
      auxWindowId: contextWindow.id,
      contextRoleTabIds: roleIds,
      contextTabId: roleTab.id,
      contextTabs,
      contextUrl: url,
      contextWindowId: contextWindow.id,
    });
    if (role !== "drive") {
      await this.updateWindow(contextWindow.id, { focused: true }, "route-aux-tab");
    }
  }

  async rememberVisibleBounds(changedWindowId = null) {
    if (changedWindowId !== null && this.isSystemGeometryChange(changedWindowId)) {
      this.logSystemGeometrySaveSkipped(changedWindowId);
      return null;
    }
    if (this.transitioning || this.movingWindowIds.size > 0) {
      this.logSystemGeometrySaveSkipped(changedWindowId);
      return null;
    }
    const state = await this.state();
    if (state.drawerState !== "open" || !validWorkArea(state.workArea)) return null;
    const rightWindowId = selectedRightWindowId(state);
    const changedRole = changedWindowId === state.phWindowId
      ? "playhouse"
      : changedWindowId === rightWindowId ? "context" : null;
    if (changedWindowId !== null && !changedRole) return null;
    const [playhouseWindow, contextWindow] = await Promise.all([
      existingWindow(this.chrome, state.phWindowId),
      existingWindow(this.chrome, rightWindowId),
    ]);
    const playhouseActual = storedBounds(playhouseWindow);
    const contextActual = storedBounds(contextWindow);
    const playhouse = playhouseActual
      ? getAnchoredPlayhouseGeometry(state.workArea, playhouseActual.width)
      : null;
    const context = actualRestingBounds(contextWindow, state.workArea);
    const capturePlayhouse = changedRole !== "context";
    const captureContext = changedRole !== "playhouse";
    if ((capturePlayhouse && !playhouse) || (captureContext && !context)) return null;
    if (capturePlayhouse) {
      this.windowTrace?.emit("workspace-controller", "PH_GEOMETRY_ACTUAL", {
        actualLeft: playhouseActual.left,
        actualTop: playhouseActual.top,
        persistedLeft: storedGeometry(state.phSession.geometry)?.left ?? null,
        reason: "manual-bounds-change",
        targetLeft: state.workArea.left,
        targetTop: state.workArea.top,
        targetWidth: playhouse.width,
        workAreaLeft: state.workArea.left,
        workAreaTop: state.workArea.top,
      });
      if (playhouseActual.left !== playhouse.left || playhouseActual.top !== playhouse.top) {
        this.windowTrace?.emit("workspace-controller", "PH_ANCHOR_CORRECTED", {
          actualLeft: playhouseActual.left,
          actualTop: playhouseActual.top,
          reason: "manual-bounds-change",
          targetLeft: playhouse.left,
          targetTop: playhouse.top,
          targetWidth: playhouse.width,
          workAreaLeft: state.workArea.left,
          workAreaTop: state.workArea.top,
        });
      }
    }
    const nextState = await this.updateState((currentState) => {
      if (this.transitioning || currentState.drawerState !== "open" ||
        currentState.phWindowId !== state.phWindowId ||
        selectedRightWindowId(currentState) !== rightWindowId) return null;
      return {
        ...currentState,
        ...(captureContext ? {
          auxSession: { ...currentState.auxSession, geometry: geometryFromBounds(context) },
          contextBounds: context,
          miscSession: { ...currentState.miscSession, geometry: geometryFromBounds(context) },
          rightSlotGeometry: geometryFromBounds(context),
        } : {}),
        ...(capturePlayhouse ? {
          phSession: { ...currentState.phSession, geometry: geometryFromBounds(playhouse) },
          playhouseBounds: playhouse,
        } : {}),
      };
    });
    if (!nextState) return null;
    const verticalUpdates = [];
    if (changedRole !== "context" &&
      (playhouseActual.left !== playhouse.left || playhouseActual.top !== playhouse.top ||
        playhouseActual.height !== playhouse.height)) {
      verticalUpdates.push(this.updateWindow(state.phWindowId, {
        ...playhouse, focused: false, state: "normal",
      }, "normalize-playhouse-anchor"));
    }
    if (changedRole !== "playhouse" &&
      (contextActual.top !== context.top || contextActual.height !== context.height)) {
      verticalUpdates.push(this.updateWindow(rightWindowId, {
        focused: false, height: context.height, state: "normal", top: context.top,
      }, "normalize-aux-height"));
    }
    await Promise.all(verticalUpdates);
    if (capturePlayhouse) {
      this.windowTrace?.emit("workspace-controller", "PH_GEOMETRY_MANUAL_CHANGE", {
        actualLeft: playhouseActual.left,
        actualTop: playhouseActual.top,
        persistedLeft: storedGeometry(state.phSession.geometry)?.left ?? null,
        reason: "manual-bounds-change-saved",
        targetLeft: state.workArea.left,
        targetTop: state.workArea.top,
        targetWidth: playhouse.width,
        workAreaLeft: state.workArea.left,
        workAreaTop: state.workArea.top,
      });
      this.logger.info?.("PH_SESSION_SAVED", { width: playhouse.width, x: state.workArea.left });
    }
    if (captureContext) {
      this.logger.info?.("AUX_SESSION_SAVED", { width: context.width, x: context.left });
    }
    return nextState;
  }

  async rememberWorkspaceTabs(windowId, reason = "tab-event") {
    if (this.isRestoreInProgress(windowId)) {
      this.logRestoreSaveSkipped(windowId, reason);
      return null;
    }
    const state = await this.state();
    const kind = windowId === state.phWindowId
      ? "playhouse"
      : windowId === state.auxWindowId ? "context"
        : windowId === state.miscWindowId ? "misc" : null;
    const eventPrefix = kind === "playhouse" ? "PH"
      : kind === "context" ? "AUX" : kind === "misc" ? "MISC" : "WORKSPACE";
    const sessionCycle = state.sessionCycle ?? state.lastSessionCycle ?? null;
    if (!kind) {
      this.logger.info?.(`${eventPrefix}_SESSION_SAVE_SKIPPED`, {
        reason: `${reason}:unknown-window`,
        sessionCycle,
        windowId,
      });
      return null;
    }
    this.logger.info?.(`${eventPrefix}_SESSION_SAVE_ATTEMPT`, {
      reason,
      restoreInProgress: false,
      session: diagnosticSession(kind === "playhouse"
        ? state.phSession
        : kind === "context" ? state.auxSession : state.miscSession),
      sessionCycle,
      windowId,
    });
    const { snapshot, tabs } = await this.snapshotWindow(kind, windowId, state);
    if (this.isRestoreInProgress(windowId)) {
      this.logRestoreSaveSkipped(windowId, reason);
      return null;
    }
    if (!snapshot) {
      if (kind === "playhouse") {
        this.recordPhSessionDiagnostic("PH_SESSION_PERSIST_RESULT", {
          reason: "snapshot_missing",
          success: false,
          tab_count: 0,
        });
        await this.flushPhSessionDiagnostics();
      }
      this.logger.info?.(`${eventPrefix}_SESSION_SAVE_SKIPPED`, {
        reason: `${reason}:no-stable-tabs`,
        sessionCycle,
        windowId,
      });
      return null;
    }
    if (kind === "playhouse") {
      this.recordPhSessionDiagnostic("PH_SESSION_SNAPSHOT_CREATED", {
        reason,
        session_cycle: sessionCycle,
        snapshot,
      });
    }
    const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
    let restoreSkipped = false;
    let nextState;
    try {
      nextState = await this.updateState((current) => {
        if (this.isRestoreInProgress(windowId)) {
          restoreSkipped = true;
          return null;
        }
        if (kind === "playhouse" && current.phWindowId !== windowId) return null;
        if (kind === "context" && current.auxWindowId !== windowId) return null;
        if (kind === "misc" && current.miscWindowId !== windowId) return null;
        return kind === "playhouse"
          ? {
              ...current,
              phSession: { ...current.phSession, tabs: snapshot },
              playhouseTabs: snapshot,
            }
          : kind === "context" ? {
              ...current,
              auxActiveTabId: activeTab?.id ?? current.auxActiveTabId,
              auxSession: { ...current.auxSession, tabs: snapshot },
              contextTabId: activeTab?.id ?? current.auxActiveTabId,
              contextTabs: snapshot,
              contextUrl: activeTab?.url ?? current.contextUrl,
            }
          : {
              ...current,
              miscActiveTabId: activeTab?.id ?? current.miscActiveTabId,
              miscSession: { ...current.miscSession, tabs: snapshot },
              miscTabs: snapshot,
            };
      });
    } catch (error) {
      if (kind === "playhouse") {
        this.recordPhSessionDiagnostic("PH_SESSION_PERSIST_RESULT", {
          reason: "storage_write_failed",
          snapshot,
          success: false,
          tab_count: snapshot.tabs.length,
        });
        await this.flushPhSessionDiagnostics();
      }
      throw error;
    }
    if (!nextState) {
      if (restoreSkipped) {
        this.logRestoreSaveSkipped(windowId, reason);
        if (kind === "playhouse") {
          this.recordPhSessionDiagnostic("PH_SESSION_PERSIST_RESULT", {
            reason: "restore_in_progress",
            snapshot,
            success: false,
            tab_count: snapshot.tabs.length,
          });
          await this.flushPhSessionDiagnostics();
        }
        return null;
      }
      this.logger.info?.(`${eventPrefix}_SESSION_SAVE_SKIPPED`, {
        reason: `${reason}:window-no-longer-live`,
        sessionCycle,
        windowId,
      });
      if (kind === "playhouse") {
        this.recordPhSessionDiagnostic("PH_SESSION_PERSIST_RESULT", {
          reason: "window_identity_changed",
          snapshot,
          success: false,
          tab_count: snapshot.tabs.length,
        });
        await this.flushPhSessionDiagnostics();
      }
      return null;
    }
    this.logger.info?.(`${eventPrefix}_SESSION_SAVE_COMPLETE`, {
      ...diagnosticSession(kind === "playhouse"
        ? nextState.phSession
        : kind === "context" ? nextState.auxSession : nextState.miscSession),
      reason,
      restoreInProgress: false,
      sessionCycle,
      windowId,
    });
    if (kind === "playhouse") {
      this.recordPhSessionDiagnostic("PH_SESSION_PERSIST_RESULT", {
        reason: "completed",
        session_cycle: sessionCycle,
        snapshot: nextState.phSession.tabs,
        success: true,
        tab_count: nextState.phSession.tabs.tabs.length,
      });
      await this.flushPhSessionDiagnostics();
    }
    return nextState;
  }

  async logClosingTabSaveSkipped(windowId) {
    const state = await this.updateState((current) => {
      if (windowId !== current.phWindowId && windowId !== current.auxWindowId &&
        windowId !== current.miscWindowId) return null;
      const sessionCycle = current.sessionCycle ?? newSessionCycleId();
      return { ...current, lastSessionCycle: sessionCycle, sessionCycle };
    });
    if (!state) return;
    const role = windowId === state.phWindowId ? "PH"
      : windowId === state.auxWindowId ? "AUX"
        : windowId === state.miscWindowId ? "MISC" : "WORKSPACE";
    this.logger.info?.(`${role}_SESSION_SAVE_SKIPPED`, {
      reason: "tab-removed:window-closing",
      sessionCycle: state.sessionCycle ?? state.lastSessionCycle ?? null,
      windowId,
    });
  }
}
