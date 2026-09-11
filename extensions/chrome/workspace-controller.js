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
  const playhouse = storedBounds(prior.savedVisibleBounds?.playhouse ?? prior.playhouseBounds);
  const context = storedBounds(prior.savedVisibleBounds?.context ?? prior.contextBounds);
  if (!playhouse || !context) return fallback;
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
    this.transitioning = false;
  }

  async state() {
    return (await this.chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? {};
  }

  async save(nextState) {
    await this.chrome.storage.local.set({ [STORAGE_KEY]: nextState });
  }

  async tabsInWindow(windowId) {
    return (await this.chrome.tabs.query({ windowId }))
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  }

  async createWindowFromTabs(bounds, savedTabs, kind) {
    let definitions = validSavedTabs(savedTabs, kind) ??
      (kind === "playhouse" ? defaultPlayhouseTabs(PLAYHOUSE_URL) : defaultAuxTabs());
    if (kind === "playhouse" && !definitions.tabs.some((tab) => tab.role === "playhouse")) {
      definitions = {
        activeIndex: definitions.activeIndex + 1,
        tabs: [defaultPlayhouseTabs(PLAYHOUSE_URL).tabs[0], ...definitions.tabs],
      };
    }
    const window = await this.chrome.windows.create({
      ...bounds,
      focused: false,
      type: "normal",
      url: definitions.tabs.map((tab) => tab.url),
    });
    if (!window?.id) throw new Error(`Chrome could not create the ${kind} window.`);
    const tabs = await this.tabsInWindow(window.id);
    if (tabs.length !== definitions.tabs.length) {
      throw new Error(`Chrome could not restore the ${kind} tabs.`);
    }
    await Promise.all(definitions.tabs.flatMap((definition, index) => (
      definition.pinned ? [this.chrome.tabs.update(tabs[index].id, { pinned: true })] : []
    )));
    await this.chrome.tabs.update(tabs[definitions.activeIndex].id, { active: true });
    const ids = roleTabIds(definitions, tabs);
    this.logger.info?.(kind === "playhouse" ? "PH_TABS_RESTORED" : "AUX_TABS_RESTORED", {
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
      : state.contextRoleTabIds ?? {};
    const snapshot = snapshotTabs(
      tabs,
      roleIds,
      kind === "playhouse" ? state.playhouseTabId : null,
    );
    return { snapshot, tabs };
  }

  async findPlayhouse(prior, bounds, positionExisting = true) {
    let window = await existingWindow(this.chrome, prior.playhouseWindowId);
    let tab = await existingTab(this.chrome, prior.playhouseTabId);
    if (!window || !tab || tab.windowId !== window.id) {
      const matches = await this.chrome.tabs.query({ url: `${PLAYHOUSE_URL}*` });
      if (matches[0]) {
        tab = matches[0];
        window = await existingWindow(this.chrome, tab.windowId);
      } else {
        tab = null;
      }
    }
    if (!window) {
      const restored = await this.createWindowFromTabs(bounds, prior.playhouseTabs, "playhouse");
      return {
        tab: restored.roleTabIds.playhouse ?
          await existingTab(this.chrome, restored.roleTabIds.playhouse) : restored.activeTab,
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

  async findContext(prior, bounds, playhouseWindowId, positionExisting = true) {
    let window = await existingWindow(this.chrome, prior.contextWindowId);
    let tab = await existingTab(this.chrome, prior.contextTabId);
    if (!window && !prior.contextTabs && isAllowedContextUrl(prior.contextUrl)) {
      const tabs = await this.chrome.tabs.query({});
      tab = tabs.find((candidate) => (
        candidate.windowId !== playhouseWindowId && candidate.url === prior.contextUrl
      )) ?? null;
      window = tab ? await existingWindow(this.chrome, tab.windowId) : null;
    }
    if (!window) {
      const restored = await this.createWindowFromTabs(bounds, prior.contextTabs, "context");
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
      let roles = { ...(prior.contextRoleTabIds ?? {}) };
      if (!prior.contextTabs) {
        const calendar = tabs.find((candidate) => candidate.url?.startsWith("https://calendar.google.com/"));
        const gmail = tabs.find((candidate) => candidate.url?.startsWith("https://mail.google.com/"));
        const misc = tabs.find((candidate) => candidate.id !== calendar?.id && candidate.id !== gmail?.id);
        roles = {
          ...(calendar?.id ? { calendar: calendar.id } : {}),
          ...(gmail?.id ? { gmail: gmail.id } : {}),
          ...(misc?.id ? { misc: misc.id } : {}),
        };
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
        tabs.find((candidate) => candidate.id === prior.contextTabId) ?? tabs[0] ?? null;
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
      existingWindow(this.chrome, state.playhouseWindowId),
      existingWindow(this.chrome, state.contextWindowId),
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
      existingWindow(this.chrome, state.playhouseWindowId),
      existingWindow(this.chrome, state.contextWindowId),
      existingTab(this.chrome, state.playhouseTabId),
      existingTab(this.chrome, state.contextTabId),
    ]);
    const playhouseIdentityValid = Boolean(playhouseWindow && playhouseTab &&
      playhouseTab.windowId === playhouseWindow.id && playhouseTab.url?.startsWith(PLAYHOUSE_URL));
    const contextIdentityValid = Boolean(contextWindow && contextTab &&
      contextTab.windowId === contextWindow.id && isAllowedContextUrl(contextTab.url));
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
      contextTabId: contextIdentityValid ? state.contextTabId : null,
      contextWindowId: contextIdentityValid ? state.contextWindowId : null,
      drawerState: "retracted",
      playhouseTabId: playhouseIdentityValid ? state.playhouseTabId : null,
      playhouseWindowId: playhouseIdentityValid ? state.playhouseWindowId : null,
    };
    await this.save(reconciled);
    return { actuallyOpen: false, state: reconciled };
  }

  async handleWindowClosed(windowId) {
    const state = await this.state();
    const playhouseClosed = windowId === state.playhouseWindowId;
    const contextClosed = windowId === state.contextWindowId;
    if (!playhouseClosed && !contextClosed) return null;
    const playhouseWindowId = playhouseClosed ? null : state.playhouseWindowId;
    const contextWindowId = contextClosed ? null : state.contextWindowId;
    const nextState = {
      ...state,
      contextTabId: contextClosed ? null : state.contextTabId,
      contextWindowId,
      drawerState: playhouseWindowId || contextWindowId ? "degraded" : "retracted",
      playhouseTabId: playhouseClosed ? null : state.playhouseTabId,
      playhouseWindowId,
    };
    await this.save(nextState);
    return nextState;
  }

  async summonDrawer(workArea, monitorId = null) {
    const prior = await this.state();
    const layout = restoredWorkspaceLayout(prior, workArea);
    const savedPlayhouse = storedBounds(prior.savedVisibleBounds?.playhouse ?? prior.playhouseBounds);
    const savedContext = storedBounds(prior.savedVisibleBounds?.context ?? prior.contextBounds);
    if (!savedPlayhouse || !savedContext) {
      this.logger.info?.("Carnival: using default workspace bounds");
    } else if (layout.playhouse.left === savedPlayhouse.left && layout.playhouse.width === savedPlayhouse.width &&
      layout.context.left === savedContext.left && layout.context.width === savedContext.width) {
      this.logger.info?.("Carnival: restoring saved visible workspace bounds");
    } else {
      this.logger.info?.("Carnival: normalizing saved bounds for new monitor");
    }
    const [knownPlayhouse, knownContext] = await Promise.all([
      existingWindow(this.chrome, prior.playhouseWindowId),
      existingWindow(this.chrome, prior.contextWindowId),
    ]);
    const shouldAnimate = prior.drawerState !== "open" || !knownPlayhouse || !knownContext;
    const hiddenOffset = -workArea.width;
    const positionExisting = !shouldAnimate || !this.nativeAnimate;
    const playhouse = await this.findPlayhouse(prior, layout.playhouse, positionExisting);
    const context = await this.findContext(prior, layout.context, playhouse.window.id, positionExisting);
    const current = {
      context: currentBounds(context.window, layout.context),
      playhouse: currentBounds(playhouse.window, layout.playhouse),
    };
    const openingState = {
      ...prior,
      contextBounds: layout.context,
      contextRoleTabIds: context.roleTabIds,
      contextTabId: context.tab.id,
      contextTabs: context.tabState,
      contextUrl: context.tab.url ?? prior.contextUrl ?? DEFAULT_CONTEXT_URL,
      contextWindowId: context.window.id,
      drawerState: shouldAnimate ? "opening" : "open",
      layoutVersion: LAYOUT_VERSION,
      monitorId,
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
      savedVisibleBounds: { context: layout.context, playhouse: layout.playhouse },
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
    const playhouseWindow = await existingWindow(this.chrome, state.playhouseWindowId);
    const contextWindow = await existingWindow(this.chrome, state.contextWindowId);
    if (!playhouseWindow || !contextWindow) {
      const retracted = { ...state, drawerState: "retracted" };
      await this.save(retracted);
      return retracted;
    }
    const layout = {
      context: storedBounds(state.savedVisibleBounds?.context ?? state.contextBounds),
      playhouse: storedBounds(state.savedVisibleBounds?.playhouse ?? state.playhouseBounds),
    };
    if (!layout.context || !layout.playhouse) return state;
    await this.save({ ...state, drawerState: "retracting" });
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
      const open = { ...state, drawerState: "open" };
      await this.save(open);
      return open;
    }
    const retracted = { ...state, drawerState: "retracted" };
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
    const existingContext = await existingWindow(this.chrome, prior.contextWindowId);
    const restoreContext = prior.drawerState !== "open" || !existingContext ||
      !hasVisibleIntersection(existingContext, workArea);
    const context = await this.findContext(
      prior,
      layout.context,
      prior.playhouseWindowId,
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
      contextBounds,
      contextRoleTabIds: roleIds,
      contextTabId: roleTab.id,
      contextTabs,
      contextUrl: url,
      contextWindowId: contextWindow.id,
      drawerState: "open",
      layoutVersion: LAYOUT_VERSION,
      monitorId,
      savedVisibleBounds: {
        ...prior.savedVisibleBounds,
        context: contextBounds,
      },
      workArea,
    });
    await this.chrome.windows.update(contextWindow.id, { focused: true });
  }

  async rememberVisibleBounds() {
    if (this.transitioning || this.movingWindowIds.size > 0) return null;
    const state = await this.state();
    if (state.drawerState !== "open" || !validWorkArea(state.workArea)) return null;
    const [playhouseWindow, contextWindow] = await Promise.all([
      existingWindow(this.chrome, state.playhouseWindowId),
      existingWindow(this.chrome, state.contextWindowId),
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
    const currentState = await this.state();
    if (this.transitioning || currentState.drawerState !== "open" ||
      currentState.playhouseWindowId !== state.playhouseWindowId ||
      currentState.contextWindowId !== state.contextWindowId) return null;
    const nextState = {
      ...currentState,
      contextBounds: context,
      playhouseBounds: playhouse,
      savedVisibleBounds: { context, playhouse },
    };
    await this.save(nextState);
    const verticalUpdates = [];
    if (playhouseActual.top !== playhouse.top || playhouseActual.height !== playhouse.height) {
      verticalUpdates.push(this.chrome.windows.update(state.playhouseWindowId, {
        focused: false, height: playhouse.height, state: "normal", top: playhouse.top,
      }));
    }
    if (contextActual.top !== context.top || contextActual.height !== context.height) {
      verticalUpdates.push(this.chrome.windows.update(state.contextWindowId, {
        focused: false, height: context.height, state: "normal", top: context.top,
      }));
    }
    await Promise.all(verticalUpdates);
    this.logger.info?.("Carnival: saved visible workspace bounds");
    return nextState;
  }

  async rememberWorkspaceTabs(windowId) {
    const state = await this.state();
    const kind = windowId === state.playhouseWindowId
      ? "playhouse"
      : windowId === state.contextWindowId ? "context" : null;
    if (!kind) return null;
    const { snapshot, tabs } = await this.snapshotWindow(kind, windowId, state);
    if (!snapshot) return null;
    const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
    const nextState = kind === "playhouse"
      ? { ...state, playhouseTabs: snapshot }
      : {
          ...state,
          contextTabId: activeTab?.id ?? state.contextTabId,
          contextTabs: snapshot,
          contextUrl: activeTab?.url ?? state.contextUrl,
        };
    await this.save(nextState);
    this.logger.info?.(kind === "playhouse" ? "PH_TABS_SAVED" : "AUX_TABS_SAVED", {
      count: snapshot.tabs.length,
    });
    return nextState;
  }
}
