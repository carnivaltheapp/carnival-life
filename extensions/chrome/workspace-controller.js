export const PLAYHOUSE_URL = "https://carnival-playhouse.vercel.app/";
export const DEFAULT_CONTEXT_URL = "https://calendar.google.com/calendar/u/0/r";

const STORAGE_KEY = "carnivalDesktopWorkspace";

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

export function defaultWorkspaceLayout(workArea) {
  if (!validWorkArea(workArea)) throw new Error("A valid monitor work area is required.");
  const leftWidth = Math.round(workArea.width * 0.4);
  return {
    context: {
      height: workArea.height,
      left: workArea.left + leftWidth,
      top: workArea.top,
      width: workArea.width - leftWidth,
    },
    playhouse: {
      height: workArea.height,
      left: workArea.left,
      top: workArea.top,
      width: leftWidth,
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
  constructor(chromeApi) {
    this.chrome = chromeApi;
  }

  async state() {
    return (await this.chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? {};
  }

  async save(nextState) {
    await this.chrome.storage.local.set({ [STORAGE_KEY]: nextState });
  }

  async summon(workArea, monitorId = null) {
    const defaults = defaultWorkspaceLayout(workArea);
    const prior = await this.state();
    const sameMonitor = monitorId && prior.monitorId === monitorId;
    const playhouseBounds = sameMonitor ? storedBounds(prior.playhouseBounds) ?? defaults.playhouse : defaults.playhouse;
    const contextBounds = sameMonitor ? storedBounds(prior.contextBounds) ?? defaults.context : defaults.context;

    let playhouseWindow = await existingWindow(this.chrome, prior.playhouseWindowId);
    let playhouseTab = await existingTab(this.chrome, prior.playhouseTabId);
    if (!playhouseWindow || !playhouseTab || playhouseTab.windowId !== playhouseWindow.id) {
      const matches = await this.chrome.tabs.query({ url: `${PLAYHOUSE_URL}*` });
      if (matches[0]) {
        playhouseTab = matches[0];
        playhouseWindow = await existingWindow(this.chrome, playhouseTab.windowId);
      } else {
        playhouseTab = null;
      }
    }
    if (!playhouseWindow) {
      playhouseWindow = await this.chrome.windows.create({
        ...playhouseBounds,
        focused: false,
        type: "normal",
        url: PLAYHOUSE_URL,
      });
      playhouseTab = playhouseWindow.tabs?.[0] ?? null;
    } else {
      await this.chrome.windows.update(playhouseWindow.id, {
        ...playhouseBounds,
        focused: false,
        state: "normal",
      });
      if (!playhouseTab) {
        playhouseTab = await this.chrome.tabs.create({
          active: true,
          url: PLAYHOUSE_URL,
          windowId: playhouseWindow.id,
        });
      }
    }

    let contextWindow = await existingWindow(this.chrome, prior.contextWindowId);
    let contextTab = await existingTab(this.chrome, prior.contextTabId);
    if (contextWindow && (!contextTab || contextTab.windowId !== contextWindow.id)) {
      contextTab = contextWindow.tabs?.find(({ active }) => active) ?? contextWindow.tabs?.[0] ?? null;
    } else if (!contextWindow) {
      contextTab = null;
    }
    if (!contextWindow) {
      contextWindow = await this.chrome.windows.create({
        ...contextBounds,
        focused: false,
        type: "normal",
        url: DEFAULT_CONTEXT_URL,
      });
      contextTab = contextWindow.tabs?.[0] ?? null;
    } else {
      await this.chrome.windows.update(contextWindow.id, {
        ...contextBounds,
        focused: false,
        state: "normal",
      });
      if (!contextTab) {
        contextTab = await this.chrome.tabs.create({
          active: true,
          url: DEFAULT_CONTEXT_URL,
          windowId: contextWindow.id,
        });
      }
    }

    const nextState = {
      ...prior,
      contextBounds,
      contextTabId: contextTab?.id,
      contextWindowId: contextWindow.id,
      monitorId,
      playhouseBounds,
      playhouseTabId: playhouseTab?.id,
      playhouseWindowId: playhouseWindow.id,
    };
    await this.save(nextState);
    await this.chrome.windows.update(contextWindow.id, { focused: true });
    await this.chrome.windows.update(playhouseWindow.id, { focused: true });
    return nextState;
  }

  async openCarnivalContext(url, workArea, monitorId = null) {
    if (!isAllowedContextUrl(url)) throw new Error("Carnival context URLs must use HTTP or HTTPS.");
    const state = await this.summon(workArea, monitorId);
    await this.chrome.tabs.update(state.contextTabId, { active: true, url });
    await this.chrome.windows.update(state.contextWindowId, { focused: true });
  }

  async rememberBounds(changedWindow) {
    const state = await this.state();
    const bounds = storedBounds(changedWindow);
    if (!bounds) return;
    if (changedWindow.id === state.playhouseWindowId) {
      await this.save({ ...state, playhouseBounds: bounds });
    } else if (changedWindow.id === state.contextWindowId) {
      await this.save({ ...state, contextBounds: bounds });
    }
  }
}
