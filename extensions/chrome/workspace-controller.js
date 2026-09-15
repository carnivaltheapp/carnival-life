import {
  AUX_ROLE_URLS,
  auxRoleForUrl,
  defaultAuxTabs,
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
  return {
    ...raw,
    auxActiveTabId,
    auxRoleTabIds,
    auxSession: legacySession(raw, "aux"),
    auxWindowId,
    contextRoleTabIds: auxRoleTabIds,
    contextTabId: auxActiveTabId,
    contextWindowId: auxWindowId,
    phPrimaryTabId,
    phSession: anchoredPhSession,
    phWindowId,
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
  const auxGeometry = storedGeometry(prior.auxSession?.geometry) ?? geometryFromBounds(
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

function diagnosticSession(session) {
  return {
    activeIndex: session?.tabs?.activeIndex ?? null,
    geometry: session?.geometry ?? null,
    roles: session?.tabs?.tabs?.map((tab) => tab.role ?? "ordinary") ?? [],
    tabCount: session?.tabs?.tabs?.length ?? 0,
    urls: session?.tabs?.tabs?.map((tab) => tab.url) ?? [],
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
    this.movingWindowIds = new Set();
    this.phRestoreInProgress = false;
    this.auxRestoreInProgress = false;
    this.restoreWindowRoles = new Map();
    this.systemGeometryWindowIds = new Set();
    this.systemGeometryTimers = new Map();
    this.geometrySettleMs = options.geometrySettleMs ?? POST_RESTORE_GEOMETRY_SETTLE_MS;
    this.creatingRestoreRole = null;
    this.stateUpdates = Promise.resolve();
    this.transitioning = false;
  }

  restoreRoleForWindow(windowId) {
    return this.restoreWindowRoles.get(windowId) ?? this.creatingRestoreRole;
  }

  isRestoreInProgress(windowId) {
    const role = this.restoreRoleForWindow(windowId);
    return role === "playhouse" ? this.phRestoreInProgress
      : role === "context" ? this.auxRestoreInProgress : false;
  }

  isSystemGeometryChange(windowId) {
    return this.transitioning || this.movingWindowIds.has(windowId) ||
      this.systemGeometryWindowIds.has(windowId) || this.isRestoreInProgress(windowId);
  }

  logRestoreSaveSkipped(windowId, reason) {
    const role = this.restoreRoleForWindow(windowId);
    const eventPrefix = role === "playhouse" ? "PH" : role === "context" ? "AUX" : "WORKSPACE";
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

  async updateWindow(windowId, options, reason) {
    await this.windowTrace?.beforeUpdate(windowId, options, reason);
    return this.chrome.windows.update(windowId, options);
  }

  async createWindowFromTabs(bounds, savedTabs, kind, sessionCycle = null) {
    let definitions = validSavedTabs(savedTabs, kind) ??
      (kind === "playhouse" ? defaultPlayhouseTabs(PLAYHOUSE_URL) : defaultAuxTabs());
    if (kind === "playhouse" && !definitions.tabs.some((tab) => tab.role === "ph-primary")) {
      definitions = {
        activeIndex: definitions.activeIndex + 1,
        tabs: [defaultPlayhouseTabs(PLAYHOUSE_URL).tabs[0], ...definitions.tabs],
      };
    }
    const eventPrefix = kind === "playhouse" ? "PH" : "AUX";
    if (kind === "playhouse") this.phRestoreInProgress = true;
    else this.auxRestoreInProgress = true;
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
      if (kind === "playhouse") this.phRestoreInProgress = false;
      else this.auxRestoreInProgress = false;
      throw error;
    } finally {
      this.creatingRestoreRole = null;
    }
    if (!window?.id) {
      if (kind === "playhouse") this.phRestoreInProgress = false;
      else this.auxRestoreInProgress = false;
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
      throw new Error(`Chrome could not restore the ${kind} tabs.`);
    }
    definitions.tabs.forEach((definition, index) => {
      this.logger.info?.(`${eventPrefix}_RESTORE_TAB_CREATED`, {
        index,
        role: definition.role,
        sessionCycle,
        tabId: tabs[index]?.id,
        url: definition.url,
        windowId: window.id,
      });
    });
    await Promise.all(definitions.tabs.flatMap((definition, index) => (
      definition.pinned ? [this.chrome.tabs.update(tabs[index].id, { pinned: true })] : []
    )));
    await this.chrome.tabs.update(tabs[definitions.activeIndex].id, { active: true });
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
    const eventPrefix = kind === "playhouse" ? "PH" : "AUX";
    const windowId = restored.window.id;
    const state = await this.state();
    const { snapshot, tabs } = await this.snapshotWindow(kind, windowId, state);
    const expectedRoles = restored.tabState.tabs.map((tab) => tab.role ?? null);
    const actualRoles = snapshot?.tabs.map((tab) => tab.role ?? null);
    const actualTabIds = tabs.map((tab) => tab.id);
    const expectedActiveId = restored.expectedTabIds[restored.tabState.activeIndex];
    const actualActiveId = tabs.find((tab) => tab.active)?.id;
    if (!snapshot ||
      JSON.stringify(actualTabIds) !== JSON.stringify(restored.expectedTabIds) ||
      JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles) ||
      actualActiveId !== expectedActiveId) {
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
    else this.auxRestoreInProgress = false;
    this.restoreWindowRoles.delete(windowId);
    const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
    const finalState = await this.updateState((current) => kind === "playhouse"
      ? {
          ...current,
          phSession: { ...current.phSession, tabs: snapshot },
          playhouseTabs: snapshot,
        }
      : {
          ...current,
          auxActiveTabId: activeTab.id,
          auxSession: { ...current.auxSession, tabs: snapshot },
          contextTabId: activeTab.id,
          contextTabs: snapshot,
          contextUrl: activeTab.url ?? current.contextUrl,
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
    this.settleSystemGeometry(windowId);
    return finalState;
  }

  cancelRestores() {
    this.phRestoreInProgress = false;
    this.auxRestoreInProgress = false;
    this.creatingRestoreRole = null;
    this.restoreWindowRoles.clear();
    this.systemGeometryWindowIds.clear();
    for (const timer of this.systemGeometryTimers.values()) clearTimeout(timer);
    this.systemGeometryTimers.clear();
  }

  async snapshotWindow(kind, windowId, state) {
    const tabs = await this.tabsInWindow(windowId);
    const roleIds = kind === "playhouse"
      ? {}
      : state.auxRoleTabIds ?? {};
    const snapshot = snapshotTabs(
      tabs,
      roleIds,
      kind === "playhouse" ? state.phPrimaryTabId : null,
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
    let tab = await existingTab(this.chrome, prior.phPrimaryTabId);
    if (!window || tab?.windowId !== window.id) tab = null;
    if (!window && startup.allowColdStartPlayhouseAdoption) {
      const adopted = await waitForColdStartPlayhouse({
        candidateWindowIds: startup.coldStartCandidateWindowIds,
        chromeApi: this.chrome,
        excludedWindowIds: [prior.auxWindowId].filter(Number.isInteger),
        onEvent: (event, details) => this.windowTrace?.emit(
          "workspace-controller",
          event,
          details,
        ),
        timeoutMs: this.coldStartCandidateTimeoutMs,
      });
      if (adopted) {
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
      const restored = await this.createWindowFromTabs(
        bounds,
        prior.phSession.tabs,
        "playhouse",
        prior.sessionCycle ?? null,
      );
      return {
        tab: restored.roleTabIds["ph-primary"] ?
          await existingTab(this.chrome, restored.roleTabIds["ph-primary"]) : restored.activeTab,
        tabState: restored.tabState,
        restore: restored,
        window: restored.window,
      };
    } else {
      await this.updateWindow(window.id, positionExisting
        ? { ...bounds, focused: false, state: "normal" }
        : { focused: false, state: "normal" }, "find-playhouse-existing");
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

  async findContext(prior, bounds, positionExisting = true) {
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
      await this.updateWindow(window.id, positionExisting
        ? { ...bounds, focused: false, state: "normal" }
        : { focused: false, state: "normal" }, "find-aux-existing");
      let tabs = await this.tabsInWindow(window.id);
      const roles = { ...(prior.auxRoleTabIds ?? {}) };
      if (!prior.auxSession.tabs) {
        for (const role of ["calendar", "gmail", "misc"]) {
          if (roles[role]) continue;
          const created = await this.chrome.tabs.create({
            active: false,
            url: AUX_ROLE_URLS[role],
            windowId: window.id,
          });
          roles[role] = created.id;
        }
        tabs = await this.tabsInWindow(window.id);
      }
      tab = tabs.find((candidate) => candidate.active) ??
        tabs.find((candidate) => candidate.id === prior.auxActiveTabId) ?? tabs[0] ?? null;
      const snapshot = snapshotTabs(tabs, roles);
      if (!tab?.id || !snapshot) throw new Error("Chrome could not identify the context tabs.");
      return { restore: null, roleTabIds: roles, tab, tabState: snapshot, window };
    }
    } finally {
      this.windowTrace?.exit("aux", {
        source: "workspace-controller",
      });
    }
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
      existingWindow(this.chrome, state.auxWindowId),
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
      existingWindow(this.chrome, state.auxWindowId),
      existingTab(this.chrome, state.phPrimaryTabId),
      existingTab(this.chrome, state.auxActiveTabId),
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
      auxActiveTabId: contextTabValid ? state.auxActiveTabId : null,
      auxWindowId: contextIdentityValid ? state.auxWindowId : null,
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
      if (!phClosed && !auxClosed) return null;
      closedRole = phClosed ? "ph" : "aux";
      const sessionCycle = state.sessionCycle ?? newSessionCycleId();
      this.logger.info?.("WINDOW_CLOSE_STARTED", {
        role: closedRole,
        session: diagnosticSession(phClosed ? state.phSession : state.auxSession),
        sessionCycle,
        windowId,
      });
      const phWindowId = phClosed ? null : state.phWindowId;
      const auxWindowId = auxClosed ? null : state.auxWindowId;
      return {
        ...state,
        auxActiveTabId: auxClosed ? null : state.auxActiveTabId,
        auxRoleTabIds: auxClosed ? {} : state.auxRoleTabIds,
        auxWindowId,
        drawerState: phWindowId || auxWindowId ? "degraded" : "retracted",
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
    return result;
  }

  async summonDrawer(workArea, monitorId = null, startup = {}) {
    const prior = await this.state();
    const layout = canonicalWorkspaceLayout(prior, workArea);
    const savedPlayhouse = storedGeometry(prior.phSession.geometry);
    const savedContext = storedGeometry(prior.auxSession.geometry);
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
      existingWindow(this.chrome, prior.auxWindowId),
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
    const context = await this.findContext(
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
    const openingState = {
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
    await this.updateWindow(context.window.id, { focused: true }, "summon-aux");
    await this.updateWindow(playhouse.window.id, { focused: true }, "summon-playhouse");
    await this.finalizeRestoredWindow("playhouse", playhouse.restore, prior.sessionCycle ?? null);
    await this.finalizeRestoredWindow("context", context.restore, prior.sessionCycle ?? null);
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
    const contextWindow = await existingWindow(this.chrome, state.auxWindowId);
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
      auxSession: { ...state.auxSession, geometry: geometryFromBounds(layout.context) },
      contextBounds: layout.context,
      phSession: { ...state.phSession, geometry: geometryFromBounds(layout.playhouse) },
      playhouseBounds: layout.playhouse,
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

  async openCarnivalContext(url, workArea, monitorId = null, requestedRole = null) {
    if (!isAllowedContextUrl(url)) throw new Error("Carnival context URLs must use HTTP or HTTPS.");
    if (!validWorkArea(workArea)) throw new Error("A valid monitor work area is required.");
    const role = requestedRole ?? auxRoleForUrl(url);
    if (role !== "contacts" && role !== "gmail" && role !== "misc" && role !== "slack") {
      throw new Error("Carnival context navigation requires a Contacts, Gmail, Slack, or Misc role.");
    }

    this.logger.info?.("Carnival: resolving Aux context window");
    const prior = await this.state();
    const layout = canonicalWorkspaceLayout(prior, workArea);
    const existingContext = await existingWindow(this.chrome, prior.auxWindowId);
    const restoreContext = prior.drawerState !== "open" || !existingContext ||
      !hasVisibleIntersection(existingContext, workArea);
    const context = await this.findContext(
      prior,
      layout.context,
      restoreContext,
    );
    const contextWindow = context.window;
    if (context.restore) {
      await this.save({
        ...prior,
        auxActiveTabId: context.tab.id,
        auxRoleTabIds: context.roleTabIds,
        auxSession: { geometry: geometryFromBounds(layout.context), tabs: context.tabState },
        auxWindowId: contextWindow.id,
        contextRoleTabIds: context.roleTabIds,
        contextTabId: context.tab.id,
        contextTabs: context.tabState,
        contextWindowId: contextWindow.id,
        layoutVersion: LAYOUT_VERSION,
        monitorId,
        workArea,
      });
      await this.finalizeRestoredWindow("context", context.restore, prior.sessionCycle ?? null);
    }
    const contactsTabs = role === "contacts"
      ? (await this.tabsInWindow(contextWindow.id)).filter((tab) => isGoogleContactsUrl(tab.url))
      : [];
    const slackTabs = role === "slack"
      ? (await this.tabsInWindow(contextWindow.id)).filter((tab) => auxRoleForUrl(tab.url) === "slack")
      : [];
    let roleTab = role === "contacts"
      ? contactsTabs.find((tab) => tab.active) ?? contactsTabs[0] ?? null
      : await existingTab(this.chrome, context.roleTabIds[role]);
    if (role === "slack" && !roleTab) {
      roleTab = slackTabs.find((tab) => tab.active) ?? slackTabs[0] ?? null;
    }
    const roleIds = { ...context.roleTabIds };
    if (!roleTab || roleTab.windowId !== contextWindow.id) {
      roleTab = await this.chrome.tabs.create({ active: true, url, windowId: contextWindow.id });
      this.logger.info?.("AUX_ROLE_TAB_CREATED", { role, tabId: roleTab.id });
    } else {
      this.logger.info?.("AUX_ROLE_TAB_FOUND", { role, tabId: roleTab.id });
      await this.chrome.tabs.update(roleTab.id, { active: true, url });
    }
    roleIds[role] = roleTab.id;
    this.logger.info?.("AUX_ROLE_TAB_ACTIVATED", { role, tabId: roleTab.id });
    const navigatedEvent = role === "gmail"
      ? "GMAIL_ROLE_NAVIGATED"
      : role === "contacts"
        ? "CONTACTS_ROLE_NAVIGATED"
        : role === "slack" ? "SLACK_ROLE_NAVIGATED" : "MISC_ROLE_NAVIGATED";
    this.logger.info?.(navigatedEvent, {
      host: new URL(url).hostname,
      path: new URL(url).pathname,
      tabId: roleTab.id,
    });
    const tabs = await this.tabsInWindow(contextWindow.id);
    const contextTabs = snapshotTabs(tabs, roleIds);
    const contextBounds = restoreContext
      ? layout.context
      : currentBounds(contextWindow, layout.context);
    await this.save({
      ...prior,
      auxActiveTabId: roleTab.id,
      auxRoleTabIds: roleIds,
      auxSession: {
        geometry: geometryFromBounds(contextBounds),
        tabs: contextTabs,
      },
      auxWindowId: contextWindow.id,
      contextBounds,
      contextRoleTabIds: roleIds,
      contextTabId: roleTab.id,
      contextTabs,
      contextUrl: url,
      contextWindowId: contextWindow.id,
      drawerState: "open",
      layoutVersion: LAYOUT_VERSION,
      monitorId,
      workArea,
    });
    await this.updateWindow(contextWindow.id, { focused: true }, "route-aux-tab");
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
    const changedRole = changedWindowId === state.phWindowId
      ? "playhouse"
      : changedWindowId === state.auxWindowId ? "context" : null;
    if (changedWindowId !== null && !changedRole) return null;
    const [playhouseWindow, contextWindow] = await Promise.all([
      existingWindow(this.chrome, state.phWindowId),
      existingWindow(this.chrome, state.auxWindowId),
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
        currentState.auxWindowId !== state.auxWindowId) return null;
      return {
        ...currentState,
        ...(captureContext ? {
          auxSession: { ...currentState.auxSession, geometry: geometryFromBounds(context) },
          contextBounds: context,
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
      verticalUpdates.push(this.updateWindow(state.auxWindowId, {
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
      : windowId === state.auxWindowId ? "context" : null;
    const eventPrefix = kind === "playhouse" ? "PH" : kind === "context" ? "AUX" : "WORKSPACE";
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
      session: diagnosticSession(kind === "playhouse" ? state.phSession : state.auxSession),
      sessionCycle,
      windowId,
    });
    const { snapshot, tabs } = await this.snapshotWindow(kind, windowId, state);
    if (this.isRestoreInProgress(windowId)) {
      this.logRestoreSaveSkipped(windowId, reason);
      return null;
    }
    if (!snapshot) {
      this.logger.info?.(`${eventPrefix}_SESSION_SAVE_SKIPPED`, {
        reason: `${reason}:no-stable-tabs`,
        sessionCycle,
        windowId,
      });
      return null;
    }
    const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
    let restoreSkipped = false;
    const nextState = await this.updateState((current) => {
      if (this.isRestoreInProgress(windowId)) {
        restoreSkipped = true;
        return null;
      }
      if (kind === "playhouse" && current.phWindowId !== windowId) return null;
      if (kind === "context" && current.auxWindowId !== windowId) return null;
      return kind === "playhouse"
        ? {
            ...current,
            phSession: { ...current.phSession, tabs: snapshot },
            playhouseTabs: snapshot,
          }
        : {
            ...current,
            auxActiveTabId: activeTab?.id ?? current.auxActiveTabId,
            auxSession: { ...current.auxSession, tabs: snapshot },
            contextTabId: activeTab?.id ?? current.auxActiveTabId,
            contextTabs: snapshot,
            contextUrl: activeTab?.url ?? current.contextUrl,
          };
    });
    if (!nextState) {
      if (restoreSkipped) {
        this.logRestoreSaveSkipped(windowId, reason);
        return null;
      }
      this.logger.info?.(`${eventPrefix}_SESSION_SAVE_SKIPPED`, {
        reason: `${reason}:window-no-longer-live`,
        sessionCycle,
        windowId,
      });
      return null;
    }
    this.logger.info?.(`${eventPrefix}_SESSION_SAVE_COMPLETE`, {
      ...diagnosticSession(kind === "playhouse" ? nextState.phSession : nextState.auxSession),
      reason,
      restoreInProgress: false,
      sessionCycle,
      windowId,
    });
    return nextState;
  }

  async logClosingTabSaveSkipped(windowId) {
    const state = await this.updateState((current) => {
      if (windowId !== current.phWindowId && windowId !== current.auxWindowId) return null;
      const sessionCycle = current.sessionCycle ?? newSessionCycleId();
      return { ...current, lastSessionCycle: sessionCycle, sessionCycle };
    });
    if (!state) return;
    const role = windowId === state.phWindowId ? "PH" : windowId === state.auxWindowId ? "AUX" : "WORKSPACE";
    this.logger.info?.(`${role}_SESSION_SAVE_SKIPPED`, {
      reason: "tab-removed:window-closing",
      sessionCycle: state.sessionCycle ?? state.lastSessionCycle ?? null,
      windowId,
    });
  }
}
