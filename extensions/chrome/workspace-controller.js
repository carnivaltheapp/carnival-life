export const PLAYHOUSE_URL = "https://carnival-playhouse.vercel.app/";
export const DEFAULT_CONTEXT_URL = "https://calendar.google.com/calendar/u/0/r";
export const DRAWER_ANIMATION_MS = 250;
export const RETRACT_DISTANCE_PX = 150;
export const DRAWER_RIGHT_GUTTER_PX = RETRACT_DISTANCE_PX + 1;

const STORAGE_KEY = "carnivalDesktopWorkspace";
const LAYOUT_VERSION = 2;
const DEFAULT_PLAYHOUSE_RATIO = 0.6;
const MIN_SURFACE_RATIO = 0.3;
const ANIMATION_FRAME_MS = 16;

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

function workspaceLayout(workArea, playhouseRatio) {
  const activationGutter = Math.min(DRAWER_RIGHT_GUTTER_PX, Math.max(0, workArea.width - 800));
  const workspaceWidth = workArea.width - activationGutter;
  const leftWidth = Math.round(workspaceWidth * playhouseRatio);
  return {
    context: {
      height: workArea.height,
      left: workArea.left + leftWidth,
      top: workArea.top,
      width: workspaceWidth - leftWidth,
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
  return workspaceLayout(workArea, DEFAULT_PLAYHOUSE_RATIO);
}

function storedBounds(value) {
  if (!value || !Number.isInteger(value.left) || !Number.isInteger(value.top)) return null;
  if (!validInteger(value.width) || !validInteger(value.height)) return null;
  return value.width >= 320 && value.height >= 400
    ? { height: value.height, left: value.left, top: value.top, width: value.width }
    : null;
}

export function restoredWorkspaceLayout(prior, workArea, monitorId) {
  const fallback = defaultWorkspaceLayout(workArea);
  const sameWorkArea = validWorkArea(prior.workArea) &&
    prior.workArea.left === workArea.left &&
    prior.workArea.top === workArea.top &&
    prior.workArea.width === workArea.width &&
    prior.workArea.height === workArea.height;
  if (
    prior.layoutVersion !== LAYOUT_VERSION ||
    (prior.monitorId !== monitorId && !sameWorkArea)
  ) return fallback;
  const playhouse = storedBounds(prior.playhouseBounds);
  const context = storedBounds(prior.contextBounds);
  if (!playhouse || !context || playhouse.left >= context.left) return fallback;
  const combinedWidth = playhouse.width + context.width;
  if (!combinedWidth) return fallback;
  const ratio = Math.min(
    1 - MIN_SURFACE_RATIO,
    Math.max(MIN_SURFACE_RATIO, playhouse.width / combinedWidth),
  );
  return workspaceLayout(workArea, ratio);
}

export function effectiveRetractThreshold(rightEdge, monitorRight) {
  return Math.min(rightEdge + RETRACT_DISTANCE_PX, monitorRight - 1);
}

function shifted(bounds, offset) {
  return { ...bounds, left: bounds.left + offset };
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
    this.animationSteps = options.animationSteps ?? Math.ceil(DRAWER_ANIMATION_MS / ANIMATION_FRAME_MS);
    this.nativeAnimate = options.nativeAnimate ?? null;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.movingWindowIds = new Set();
    this.transitioning = false;
  }

  async state() {
    return (await this.chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? {};
  }

  async save(nextState) {
    await this.chrome.storage.local.set({ [STORAGE_KEY]: nextState });
  }

  async findPlayhouse(prior, bounds) {
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
      await this.chrome.windows.update(window.id, { ...bounds, focused: false, state: "normal" });
      if (!tab) {
        tab = await this.chrome.tabs.create({ active: true, url: PLAYHOUSE_URL, windowId: window.id });
      }
    }
    if (!tab?.id) throw new Error("Chrome could not identify the PlayHouse tab.");
    return { tab, window };
  }

  async findContext(prior, bounds, playhouseWindowId) {
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
      await this.chrome.windows.update(window.id, { ...bounds, focused: false, state: "normal" });
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

  async animate(playhouseWindowId, contextWindowId, layout, startOffset, endOffset, easing) {
    this.movingWindowIds.add(playhouseWindowId);
    this.movingWindowIds.add(contextWindowId);
    try {
      if (this.nativeAnimate && await this.nativeAnimate({
        context: {
          from: shifted(layout.context, startOffset),
          to: shifted(layout.context, endOffset),
        },
        durationMs: DRAWER_ANIMATION_MS,
        easing: easing === easeInCubic ? "in" : "out",
        playhouse: {
          from: shifted(layout.playhouse, startOffset),
          to: shifted(layout.playhouse, endOffset),
        },
      })) return;
      for (let step = 1; step <= this.animationSteps; step += 1) {
        const progress = easing(step / this.animationSteps);
        const offset = Math.round(startOffset + ((endOffset - startOffset) * progress));
        await Promise.all([
          this.chrome.windows.update(playhouseWindowId, { left: layout.playhouse.left + offset }),
          this.chrome.windows.update(contextWindowId, { left: layout.context.left + offset }),
        ]);
        if (step < this.animationSteps) {
          await this.sleep(DRAWER_ANIMATION_MS / this.animationSteps);
        }
      }
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

  async summonDrawer(workArea, monitorId = null) {
    const prior = await this.state();
    const layout = restoredWorkspaceLayout(prior, workArea, monitorId);
    const [knownPlayhouse, knownContext] = await Promise.all([
      existingWindow(this.chrome, prior.playhouseWindowId),
      existingWindow(this.chrome, prior.contextWindowId),
    ]);
    const shouldAnimate = prior.drawerState !== "open" || !knownPlayhouse || !knownContext;
    const hiddenOffset = -workArea.width;
    const initialLayout = shouldAnimate
      ? { context: shifted(layout.context, hiddenOffset), playhouse: shifted(layout.playhouse, hiddenOffset) }
      : layout;

    const playhouse = await this.findPlayhouse(prior, initialLayout.playhouse);
    const context = await this.findContext(prior, initialLayout.context, playhouse.window.id);
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
      await this.animate(playhouse.window.id, context.window.id, layout, hiddenOffset, 0, easeOutCubic);
    }
    const openState = { ...openingState, drawerState: "open" };
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
      context: storedBounds(state.contextBounds),
      playhouse: storedBounds(state.playhouseBounds),
    };
    if (!layout.context || !layout.playhouse) return state;
    await this.save({ ...state, drawerState: "retracting" });
    await this.animate(playhouseWindow.id, contextWindow.id, layout, 0, -state.workArea.width, easeInCubic);
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

  async rememberBounds(changedWindow) {
    if (this.transitioning || this.movingWindowIds.has(changedWindow.id)) return null;
    const state = await this.state();
    if (state.drawerState !== "open") return null;
    const bounds = storedBounds(changedWindow);
    if (!bounds) return null;
    let nextState = null;
    if (changedWindow.id === state.playhouseWindowId) {
      nextState = { ...state, playhouseBounds: bounds };
    } else if (changedWindow.id === state.contextWindowId) {
      nextState = { ...state, contextBounds: bounds };
    }
    if (nextState) await this.save(nextState);
    return nextState;
  }

  async rememberContextTab(tabId, changeInfo, tab) {
    if (!changeInfo.url || !isAllowedContextUrl(changeInfo.url)) return;
    const state = await this.state();
    if (tabId !== state.contextTabId || tab.windowId !== state.contextWindowId) return;
    await this.save({ ...state, contextUrl: changeInfo.url });
  }
}
