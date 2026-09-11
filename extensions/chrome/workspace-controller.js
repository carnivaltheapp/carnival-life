export const PLAYHOUSE_URL = "https://carnival-playhouse.vercel.app/";
export const DEFAULT_CONTEXT_URL = "https://calendar.google.com/calendar/u/0/r";
export const OPEN_ANIMATION_MS = 450;
export const CLOSE_ANIMATION_MS = 400;
export const RETRACT_DISTANCE_PX = 100;
export const DRAWER_RIGHT_GUTTER_PX = RETRACT_DISTANCE_PX;

const STORAGE_KEY = "carnivalDesktopWorkspace";
const LAYOUT_VERSION = 2;
const DEFAULT_PLAYHOUSE_RATIO = 0.6;
export const MIN_PLAYHOUSE_WIDTH = 400;
export const MIN_CONTEXT_WIDTH = 320;
const GEOMETRY_TOLERANCE_PX = 4;
const GEOMETRY_STATE = Object.freeze({
  IDLE: "IDLE",
  PROGRAMMATIC_UPDATE: "PROGRAMMATIC_UPDATE",
  RESIZING: "RESIZING",
});

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

export function coupledWorkspaceLayout(workArea, playhouseWidth, contextWidth, requestedTotal) {
  if (!validWorkArea(workArea)) throw new Error("A valid monitor work area is required.");
  const priorTotal = playhouseWidth + contextWidth;
  const ratio = priorTotal > 0 ? playhouseWidth / priorTotal : DEFAULT_PLAYHOUSE_RATIO;
  const maximumTotal = availableWorkspaceWidth(workArea);
  const minimumTotal = Math.min(MIN_PLAYHOUSE_WIDTH + MIN_CONTEXT_WIDTH, maximumTotal);
  const total = Math.max(minimumTotal, Math.min(requestedTotal ?? priorTotal, maximumTotal));
  const leftWidth = Math.max(
    Math.min(MIN_PLAYHOUSE_WIDTH, total - MIN_CONTEXT_WIDTH),
    Math.min(total - MIN_CONTEXT_WIDTH, Math.round(total * ratio)),
  );
  return {
    context: {
      height: workArea.height,
      left: workArea.left + leftWidth,
      top: workArea.top,
      width: total - leftWidth,
    },
    playhouse: {
      height: workArea.height,
      left: workArea.left,
      top: workArea.top,
      width: leftWidth,
    },
  };
}

export function defaultWorkspaceLayout(workArea) {
  if (!validWorkArea(workArea)) throw new Error("A valid monitor work area is required.");
  const total = availableWorkspaceWidth(workArea);
  return coupledWorkspaceLayout(workArea, total * DEFAULT_PLAYHOUSE_RATIO,
    total * (1 - DEFAULT_PLAYHOUSE_RATIO), total);
}

function storedBounds(value) {
  if (!value || !Number.isInteger(value.left) || !Number.isInteger(value.top)) return null;
  if (!validInteger(value.width) || !validInteger(value.height)) return null;
  return value.width >= 320 && value.height >= 400
    ? { height: value.height, left: value.left, top: value.top, width: value.width }
    : null;
}

function boundsFitWorkArea(bounds, workArea) {
  return bounds.left >= workArea.left && bounds.top >= workArea.top &&
    bounds.left + bounds.width <= workArea.left + workArea.width &&
    bounds.top + bounds.height <= workArea.top + workArea.height;
}

export function restoredWorkspaceLayout(prior, workArea) {
  const fallback = defaultWorkspaceLayout(workArea);
  if (prior.layoutVersion !== LAYOUT_VERSION) return fallback;
  const playhouse = storedBounds(prior.savedVisibleBounds?.playhouse ?? prior.playhouseBounds);
  const context = storedBounds(prior.savedVisibleBounds?.context ?? prior.contextBounds);
  if (!playhouse || !context || playhouse.left >= context.left) return fallback;
  return coupledWorkspaceLayout(workArea, playhouse.width, context.width);
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

function boundsMatch(first, second) {
  return first && second && ["height", "left", "top", "width"].every(
    (key) => Math.abs(first[key] - second[key]) <= GEOMETRY_TOLERANCE_PX,
  );
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

export class CarnivalWorkspaceController {
  constructor(chromeApi, options = {}) {
    this.chrome = chromeApi;
    this.logger = options.logger ?? console;
    this.nativeActivate = options.nativeActivate ?? null;
    this.nativeAnimate = options.nativeAnimate ?? null;
    this.nativeSetBounds = options.nativeSetBounds ?? null;
    this.movingWindowIds = new Set();
    this.programmaticBounds = new Map();
    this.geometryState = GEOMETRY_STATE.IDLE;
    this.transitioning = false;
  }

  async state() {
    return (await this.chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? {};
  }

  async save(nextState) {
    await this.chrome.storage.local.set({ [STORAGE_KEY]: nextState });
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
      window = await this.chrome.windows.create({ ...bounds, focused: false, type: "normal", url: PLAYHOUSE_URL });
      if (!window?.id) throw new Error("Chrome could not create the PlayHouse window.");
      tab = window.tabs?.[0] ?? null;
    } else {
      await this.chrome.windows.update(window.id, positionExisting
        ? { ...bounds, focused: false, state: "normal" }
        : { focused: false, state: "normal" });
      if (!tab) {
        tab = await this.chrome.tabs.create({ active: true, url: PLAYHOUSE_URL, windowId: window.id });
      }
    }
    if (!tab?.id) throw new Error("Chrome could not identify the PlayHouse tab.");
    return { tab, window };
  }

  async findContext(prior, bounds, playhouseWindowId, positionExisting = true) {
    let window = await existingWindow(this.chrome, prior.contextWindowId);
    let tab = await existingTab(this.chrome, prior.contextTabId);
    if (window && (!tab || tab.windowId !== window.id)) {
      tab = window.tabs?.find(({ active }) => active) ?? window.tabs?.[0] ?? null;
    } else if (!window && isAllowedContextUrl(prior.contextUrl)) {
      const tabs = await this.chrome.tabs.query({});
      tab = tabs.find((candidate) => (
        candidate.windowId !== playhouseWindowId && candidate.url === prior.contextUrl
      )) ?? null;
      window = tab ? await existingWindow(this.chrome, tab.windowId) : null;
    }
    if (!window) {
      window = await this.chrome.windows.create({
        ...bounds,
        focused: false,
        type: "normal",
        url: prior.contextUrl && isAllowedContextUrl(prior.contextUrl)
          ? prior.contextUrl
          : DEFAULT_CONTEXT_URL,
      });
      if (!window?.id) throw new Error("Chrome could not create the context window.");
      tab = window.tabs?.[0] ?? null;
    } else {
      await this.chrome.windows.update(window.id, positionExisting
        ? { ...bounds, focused: false, state: "normal" }
        : { focused: false, state: "normal" });
      if (!tab) {
        tab = await this.chrome.tabs.create({
          active: true,
          url: prior.contextUrl && isAllowedContextUrl(prior.contextUrl)
            ? prior.contextUrl
            : DEFAULT_CONTEXT_URL,
          windowId: window.id,
        });
      }
    }
    if (!tab?.id) throw new Error("Chrome could not identify the context tab.");
    return { tab, window };
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

  consumeProgrammaticBounds(changedWindow) {
    const expected = this.programmaticBounds.get(changedWindow.id);
    if (!boundsMatch(changedWindow, expected)) return false;
    this.programmaticBounds.delete(changedWindow.id);
    return true;
  }

  beginNativeResize() {
    if (this.geometryState !== GEOMETRY_STATE.IDLE) return false;
    this.programmaticBounds.clear();
    this.geometryState = GEOMETRY_STATE.RESIZING;
    return true;
  }

  async completeNativeResize({ context, playhouse }) {
    if (this.geometryState !== GEOMETRY_STATE.RESIZING) return null;
    try {
      const state = await this.state();
      const nextBounds = {
        context: storedBounds(context),
        playhouse: storedBounds(playhouse),
      };
      if (state.drawerState !== "open" || !validWorkArea(state.workArea) ||
        !nextBounds.playhouse || !nextBounds.context ||
        !boundsFitWorkArea(nextBounds.playhouse, state.workArea) ||
        !boundsFitWorkArea(nextBounds.context, state.workArea)) return null;
      const authoritative = coupledWorkspaceLayout(
        state.workArea,
        nextBounds.playhouse.width,
        nextBounds.context.width,
        nextBounds.playhouse.width + nextBounds.context.width,
      );
      if (!boundsMatch(nextBounds.playhouse, authoritative.playhouse) ||
        !boundsMatch(nextBounds.context, authoritative.context)) return null;
      this.programmaticBounds.set(state.playhouseWindowId, authoritative.playhouse);
      this.programmaticBounds.set(state.contextWindowId, authoritative.context);
      const nextState = {
        ...state,
        contextBounds: authoritative.context,
        playhouseBounds: authoritative.playhouse,
        savedVisibleBounds: authoritative,
      };
      await this.save(nextState);
      this.logger.info?.("Carnival: saved final native resize bounds");
      return nextState;
    } finally {
      this.geometryState = GEOMETRY_STATE.IDLE;
    }
  }

  async reconcileWorkspace(changedWindow) {
    if (this.transitioning || this.movingWindowIds.has(changedWindow.id) ||
      this.consumeProgrammaticBounds(changedWindow) ||
      this.geometryState !== GEOMETRY_STATE.IDLE) return null;
    this.geometryState = GEOMETRY_STATE.PROGRAMMATIC_UPDATE;
    try {
      const state = await this.state();
      if (state.drawerState !== "open" || !validWorkArea(state.workArea)) return null;
      if (changedWindow.id !== state.playhouseWindowId && changedWindow.id !== state.contextWindowId) return null;
      const saved = restoredWorkspaceLayout(state, state.workArea, state.monitorId);
      const [playhouseWindow, contextWindow] = await Promise.all([
        existingWindow(this.chrome, state.playhouseWindowId),
        existingWindow(this.chrome, state.contextWindowId),
      ]);
      if (!playhouseWindow || !contextWindow) return null;
      const target = coupledWorkspaceLayout(
        state.workArea,
        saved.playhouse.width,
        saved.context.width,
        saved.playhouse.width + saved.context.width,
      );
      const current = {
        context: currentBounds(contextWindow, saved.context),
        playhouse: currentBounds(playhouseWindow, saved.playhouse),
      };
      if (boundsMatch(current.playhouse, target.playhouse) && boundsMatch(current.context, target.context)) return null;
      this.programmaticBounds.set(playhouseWindow.id, target.playhouse);
      this.programmaticBounds.set(contextWindow.id, target.context);
      const positioned = this.nativeSetBounds && await this.nativeSetBounds({ current, target });
      if (!positioned) {
        await Promise.all([
          this.chrome.windows.update(playhouseWindow.id, { ...target.playhouse, focused: false, state: "normal" }),
          this.chrome.windows.update(contextWindow.id, { ...target.context, focused: false, state: "normal" }),
        ]);
      }
      return { ...state, contextBounds: target.context, playhouseBounds: target.playhouse };
    } finally {
      this.geometryState = GEOMETRY_STATE.IDLE;
    }
  }

  async summonDrawer(workArea, monitorId = null) {
    const prior = await this.state();
    const layout = restoredWorkspaceLayout(prior, workArea, monitorId);
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
      contextTabId: context.tab.id,
      contextUrl: context.tab.url ?? prior.contextUrl ?? DEFAULT_CONTEXT_URL,
      contextWindowId: context.window.id,
      drawerState: shouldAnimate ? "opening" : "open",
      layoutVersion: LAYOUT_VERSION,
      monitorId,
      playhouseBounds: layout.playhouse,
      playhouseTabId: playhouse.tab.id,
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

  async openCarnivalContext(url, workArea, monitorId = null) {
    if (!isAllowedContextUrl(url)) throw new Error("Carnival context URLs must use HTTP or HTTPS.");
    const state = await this.summon(workArea, monitorId);
    await this.chrome.tabs.update(state.contextTabId, { active: true, url });
    await this.save({ ...state, contextUrl: url });
    await this.chrome.windows.update(state.contextWindowId, { focused: true });
  }

  async rememberVisibleBounds() {
    if (this.geometryState !== GEOMETRY_STATE.IDLE || this.transitioning ||
      this.movingWindowIds.size > 0) return null;
    const state = await this.state();
    if (state.drawerState !== "open" || !validWorkArea(state.workArea)) return null;
    const [playhouseWindow, contextWindow] = await Promise.all([
      existingWindow(this.chrome, state.playhouseWindowId),
      existingWindow(this.chrome, state.contextWindowId),
    ]);
    const playhouse = storedBounds(playhouseWindow);
    const context = storedBounds(contextWindow);
    if (!playhouse || !context ||
      !boundsFitWorkArea(playhouse, state.workArea) || !boundsFitWorkArea(context, state.workArea)) return null;
    const authoritative = coupledWorkspaceLayout(
      state.workArea,
      playhouse.width,
      context.width,
      playhouse.width + context.width,
    );
    if (!boundsMatch(playhouse, authoritative.playhouse) || !boundsMatch(context, authoritative.context)) return null;
    const currentState = await this.state();
    if (this.transitioning || currentState.drawerState !== "open" ||
      currentState.playhouseWindowId !== state.playhouseWindowId ||
      currentState.contextWindowId !== state.contextWindowId) return null;
    const nextState = {
      ...currentState,
      contextBounds: authoritative.context,
      playhouseBounds: authoritative.playhouse,
      savedVisibleBounds: authoritative,
    };
    await this.save(nextState);
    this.logger.info?.("Carnival: saved visible workspace bounds");
    return nextState;
  }

  async rememberContextTab(tabId, changeInfo, tab) {
    if (!changeInfo.url || !isAllowedContextUrl(changeInfo.url)) return;
    const state = await this.state();
    if (tabId !== state.contextTabId || tab.windowId !== state.contextWindowId) return;
    await this.save({ ...state, contextUrl: changeInfo.url });
  }
}
