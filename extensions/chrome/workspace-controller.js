import {
  AUX_ROLE_URLS,
  auxRoleForUrl,
  defaultAuxTabs,
  defaultPlayhouseTabs,
  snapshotTabs,
  validSavedTabs,
} from "./workspace-tabs.js";

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
    phSession: legacySession(raw, "ph"),
    phWindowId,
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

export function restoredWorkspaceLayout(prior, workArea) {
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
  const playhouse = {
    height: priorWorkArea.height,
    left: phGeometry.left,
    top: priorWorkArea.top,
    width: phGeometry.width,
  };
  const context = {
    height: priorWorkArea.height,
    left: auxGeometry.left,
    top: priorWorkArea.top,
    width: auxGeometry.width,
  };
  return {
    context: restoreWindowBounds(context, prior.workArea, workArea),
    playhouse: restoreWindowBounds(playhouse, prior.workArea, workArea),
  };
}

export function effectiveRetractThreshold(rightEdge, monitorRight) {
  return Math.min(rightEdge + RETRACT_DISTANCE_PX, monitorRight - 1);
}

function shifted(bounds, offset) {
  return { ...bounds, left: bounds.left + offset };
}

function currentBounds(window, fallback) {
  return storedBounds(window) ?? fallback;
}

function easeOutCubic(progress) {
  return 1 - ((1 - progress) ** 3);
}

function easeInCubic(progress) {
  return progress ** 3;
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

export class CarnivalWorkspaceController {
  constructor(chromeApi, options = {}) {
    this.chrome = chromeApi;
    this.logger = options.logger ?? console;
    this.nativeActivate = options.nativeActivate ?? null;
    this.nativeAnimate = options.nativeAnimate ?? null;
    this.movingWindowIds = new Set();
    this.stateUpdates = Promise.resolve();
    this.transitioning = false;
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

  async createWindowFromTabs(bounds, savedTabs, kind) {
    let definitions = validSavedTabs(savedTabs, kind) ??
      (kind === "playhouse" ? defaultPlayhouseTabs(PLAYHOUSE_URL) : defaultAuxTabs());
    if (kind === "playhouse" && !definitions.tabs.some((tab) => tab.role === "ph-primary")) {
      definitions = {
        activeIndex: definitions.activeIndex + 1,
        tabs: [defaultPlayhouseTabs(PLAYHOUSE_URL).tabs[0], ...definitions.tabs],
      };
    }
    const eventPrefix = kind === "playhouse" ? "PH" : "AUX";
    this.logger.info?.(`${eventPrefix}_SESSION_RESTORE_STARTED`, {
      count: definitions.tabs.length,
    });
    const window = await this.chrome.windows.create({
      ...bounds,
      focused: false,
      type: "normal",
      url: definitions.tabs.map((tab) => tab.url),
    });
    if (!window?.id) throw new Error(`Chrome could not create the ${kind} window.`);
    this.logger.info?.(`${eventPrefix}_WINDOW_CREATED`, { windowId: window.id });
    this.logger.info?.(`${eventPrefix}_GEOMETRY_RESTORED`, {
      width: bounds.width,
      x: bounds.left,
    });
    const tabs = await this.tabsInWindow(window.id);
    if (tabs.length !== definitions.tabs.length) {
      throw new Error(`Chrome could not restore the ${kind} tabs.`);
    }
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
      roleTabIds: ids,
      tabState: definitions,
      window,
    };
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

  async findPlayhouse(prior, bounds, positionExisting = true) {
    const window = await existingWindow(this.chrome, prior.phWindowId);
    let tab = await existingTab(this.chrome, prior.phPrimaryTabId);
    if (!window || tab?.windowId !== window.id) tab = null;
    if (!window) {
      const restored = await this.createWindowFromTabs(bounds, prior.phSession.tabs, "playhouse");
      return {
        tab: restored.roleTabIds["ph-primary"] ?
          await existingTab(this.chrome, restored.roleTabIds["ph-primary"]) : restored.activeTab,
        tabState: restored.tabState,
        window: restored.window,
      };
    } else {
      await this.chrome.windows.update(window.id, positionExisting
        ? { ...bounds, focused: false, state: "normal" }
        : { focused: false, state: "normal" });
      if (!tab) {
        tab = await this.chrome.tabs.create({ active: true, url: PLAYHOUSE_URL, windowId: window.id });
      }
    }
    if (!tab?.id) throw new Error("Chrome could not identify the PlayHouse tab.");
    const { snapshot } = await this.snapshotWindow("playhouse", window.id, {
      ...prior,
      playhouseTabId: tab.id,
    });
    return { tab, tabState: snapshot ?? defaultPlayhouseTabs(PLAYHOUSE_URL), window };
  }

  async findContext(prior, bounds, positionExisting = true) {
    const window = await existingWindow(this.chrome, prior.auxWindowId);
    let tab = await existingTab(this.chrome, prior.auxActiveTabId);
    if (!window || tab?.windowId !== window.id) tab = null;
    if (!window) {
      const restored = await this.createWindowFromTabs(bounds, prior.auxSession.tabs, "context");
      return {
        roleTabIds: restored.roleTabIds,
        tab: restored.activeTab,
        tabState: restored.tabState,
        window: restored.window,
      };
    } else {
      await this.chrome.windows.update(window.id, positionExisting
        ? { ...bounds, focused: false, state: "normal" }
        : { focused: false, state: "normal" });
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
      return { roleTabIds: roles, tab, tabState: snapshot, window };
    }
  }

  async animate(playhouseWindowId, contextWindowId, current, layout, startOffset, endOffset, easing, durationMs) {
    this.movingWindowIds.add(playhouseWindowId);
    this.movingWindowIds.add(contextWindowId);
    try {
      if (this.nativeAnimate && await this.nativeAnimate({
        context: {
          current: current.context,
          from: shifted(layout.context, startOffset),
          to: shifted(layout.context, endOffset),
        },
        durationMs,
        easing: easing === easeInCubic ? "in" : "out",
        playhouse: {
          current: current.playhouse,
          from: shifted(layout.playhouse, startOffset),
          to: shifted(layout.playhouse, endOffset),
        },
      })) return true;
      this.logger.warn("Carnival native animation unavailable; using visible fallback");
      if (endOffset !== 0) return false;
      await Promise.all([
        this.chrome.windows.update(playhouseWindowId, { ...layout.playhouse, focused: false, state: "normal" }),
        this.chrome.windows.update(contextWindowId, { ...layout.context, focused: false, state: "normal" }),
      ]);
      return true;
    } finally {
      this.movingWindowIds.delete(playhouseWindowId);
      this.movingWindowIds.delete(contextWindowId);
    }
  }

  async summon(workArea, monitorId = null) {
    this.transitioning = true;
    try {
      return await this.summonDrawer(workArea, monitorId);
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
    await this.chrome.windows.update(contextWindow.id, { focused: true });
    await this.chrome.windows.update(playhouseWindow.id, { focused: true });
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
    return this.updateState((state) => {
      const phClosed = windowId === state.phWindowId;
      const auxClosed = windowId === state.auxWindowId;
      if (!phClosed && !auxClosed) return null;
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
      };
    });
  }

  async summonDrawer(workArea, monitorId = null) {
    const prior = await this.state();
    const layout = restoredWorkspaceLayout(prior, workArea);
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
    const repairingOneSide = Boolean(knownPlayhouse) !== Boolean(knownContext);
    const shouldAnimate = !repairingOneSide &&
      (prior.drawerState !== "open" || !knownPlayhouse || !knownContext);
    const hiddenOffset = -workArea.width;
    const positionExisting = !shouldAnimate || !this.nativeAnimate;
    const playhouse = await this.findPlayhouse(
      prior,
      layout.playhouse,
      positionExisting && !(repairingOneSide && knownPlayhouse),
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
        hiddenOffset,
        0,
        easeOutCubic,
        OPEN_ANIMATION_MS,
      );
    }
    const openState = {
      ...openingState,
      drawerState: "open",
    };
    await this.save(openState);
    await this.chrome.windows.update(context.window.id, { focused: true });
    await this.chrome.windows.update(playhouse.window.id, { focused: true });
    return openState;
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
    const playhouseVisible = storedBounds(playhouseWindow);
    const contextVisible = storedBounds(contextWindow);
    const visibleState = playhouseVisible && contextVisible &&
      hasVisibleIntersection(playhouseWindow, state.workArea) &&
      hasVisibleIntersection(contextWindow, state.workArea) &&
      horizontalBoundsFitWorkArea(playhouseVisible, state.workArea) &&
      horizontalBoundsFitWorkArea(contextVisible, state.workArea)
      ? {
          ...state,
          auxSession: { ...state.auxSession, geometry: geometryFromBounds(contextVisible) },
          contextBounds: contextVisible,
          phSession: { ...state.phSession, geometry: geometryFromBounds(playhouseVisible) },
          playhouseBounds: playhouseVisible,
        }
      : state;
    const layout = restoredWorkspaceLayout(visibleState, state.workArea);
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
      0,
      -state.workArea.width,
      easeInCubic,
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
    if (role !== "gmail" && role !== "misc") {
      throw new Error("Carnival context navigation requires a Gmail or Misc role.");
    }

    this.logger.info?.("Carnival: resolving Aux context window");
    const prior = await this.state();
    const layout = restoredWorkspaceLayout(prior, workArea);
    const existingContext = await existingWindow(this.chrome, prior.auxWindowId);
    const restoreContext = prior.drawerState !== "open" || !existingContext ||
      !hasVisibleIntersection(existingContext, workArea);
    const context = await this.findContext(
      prior,
      layout.context,
      restoreContext,
    );
    const contextWindow = context.window;
    let roleTab = await existingTab(this.chrome, context.roleTabIds[role]);
    const roleIds = { ...context.roleTabIds };
    if (!roleTab || roleTab.windowId !== contextWindow.id) {
      roleTab = await this.chrome.tabs.create({ active: true, url, windowId: contextWindow.id });
      roleIds[role] = roleTab.id;
      this.logger.info?.("AUX_ROLE_TAB_CREATED", { role, tabId: roleTab.id });
    } else {
      this.logger.info?.("AUX_ROLE_TAB_FOUND", { role, tabId: roleTab.id });
      await this.chrome.tabs.update(roleTab.id, { active: true, url });
    }
    this.logger.info?.("AUX_ROLE_TAB_ACTIVATED", { role, tabId: roleTab.id });
    this.logger.info?.(role === "gmail" ? "GMAIL_ROLE_NAVIGATED" : "MISC_ROLE_NAVIGATED", {
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
    await this.chrome.windows.update(contextWindow.id, { focused: true });
  }

  async rememberVisibleBounds() {
    if (this.transitioning || this.movingWindowIds.size > 0) return null;
    const state = await this.state();
    if (state.drawerState !== "open" || !validWorkArea(state.workArea)) return null;
    const [playhouseWindow, contextWindow] = await Promise.all([
      existingWindow(this.chrome, state.phWindowId),
      existingWindow(this.chrome, state.auxWindowId),
    ]);
    const playhouseActual = storedBounds(playhouseWindow);
    const contextActual = storedBounds(contextWindow);
    const playhouse = playhouseActual && horizontalBoundsFitWorkArea(playhouseActual, state.workArea)
      ? { ...playhouseActual, height: state.workArea.height, top: state.workArea.top }
      : null;
    const context = contextActual && horizontalBoundsFitWorkArea(contextActual, state.workArea)
      ? { ...contextActual, height: state.workArea.height, top: state.workArea.top }
      : null;
    if (!playhouse || !context ||
      !horizontalBoundsFitWorkArea(playhouse, state.workArea) ||
      !horizontalBoundsFitWorkArea(context, state.workArea)) return null;
    const nextState = await this.updateState((currentState) => {
      if (this.transitioning || currentState.drawerState !== "open" ||
        currentState.phWindowId !== state.phWindowId ||
        currentState.auxWindowId !== state.auxWindowId) return null;
      return {
        ...currentState,
        auxSession: { ...currentState.auxSession, geometry: geometryFromBounds(context) },
        contextBounds: context,
        phSession: { ...currentState.phSession, geometry: geometryFromBounds(playhouse) },
        playhouseBounds: playhouse,
      };
    });
    if (!nextState) return null;
    const verticalUpdates = [];
    if (playhouseActual.top !== playhouse.top || playhouseActual.height !== playhouse.height) {
      verticalUpdates.push(this.chrome.windows.update(state.phWindowId, {
        focused: false, height: playhouse.height, state: "normal", top: playhouse.top,
      }));
    }
    if (contextActual.top !== context.top || contextActual.height !== context.height) {
      verticalUpdates.push(this.chrome.windows.update(state.auxWindowId, {
        focused: false, height: context.height, state: "normal", top: context.top,
      }));
    }
    await Promise.all(verticalUpdates);
    this.logger.info?.("PH_SESSION_SAVED", { width: playhouse.width, x: playhouse.left });
    this.logger.info?.("AUX_SESSION_SAVED", { width: context.width, x: context.left });
    return nextState;
  }

  async rememberWorkspaceTabs(windowId) {
    const state = await this.state();
    const kind = windowId === state.phWindowId
      ? "playhouse"
      : windowId === state.auxWindowId ? "context" : null;
    if (!kind) return null;
    const { snapshot, tabs } = await this.snapshotWindow(kind, windowId, state);
    if (!snapshot) return null;
    const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
    const nextState = await this.updateState((current) => {
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
    if (!nextState) return null;
    this.logger.info?.(kind === "playhouse" ? "PH_SESSION_SAVED" : "AUX_SESSION_SAVED", {
      count: snapshot.tabs.length,
    });
    return nextState;
  }
}
