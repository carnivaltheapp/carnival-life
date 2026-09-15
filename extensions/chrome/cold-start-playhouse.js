const DEFAULT_TIMEOUT_MS = 3500;
const PLAYHOUSE_ORIGIN = "https://carnival-playhouse.vercel.app";

export function isPlayhouseUrl(value) {
  try {
    return new URL(value).origin === PLAYHOUSE_ORIGIN;
  } catch {
    return false;
  }
}

function playhouseTab(window) {
  return window?.tabs?.find((tab) => isPlayhouseUrl(tab.url)) ?? null;
}

function unresolvedTab(window) {
  const active = window?.tabs?.find((tab) => tab.active);
  return active?.status === "loading" ? active : null;
}

async function inspectCandidate(chromeApi, candidateWindowIds, excludedWindowIds) {
  const allowed = new Set(candidateWindowIds);
  const excluded = new Set(excludedWindowIds);
  const windows = (await chromeApi.windows.getAll({ populate: true })).filter((window) => (
    allowed.has(window.id) && !excluded.has(window.id) && window.type === "normal"
  ));
  const resolved = windows.flatMap((window) => {
    const tab = playhouseTab(window);
    return tab ? [{ tab, window }] : [];
  });
  if (resolved.length === 1) return { outcome: "playhouse", ...resolved[0] };
  if (resolved.length > 1) return { outcome: "rejected", reason: "multiple-playhouse-candidates" };
  const unresolved = windows.flatMap((window) => {
    const tab = unresolvedTab(window);
    return tab ? [{ tab, window }] : [];
  });
  if (unresolved.length !== 1) {
    return {
      outcome: "rejected",
      reason: unresolved.length ? "multiple-unresolved-candidates" : "no-unresolved-startup-candidate",
    };
  }
  return { outcome: "waiting", ...unresolved[0] };
}

export async function waitForColdStartPlayhouse({
  candidateWindowIds,
  chromeApi,
  clearTimer = clearTimeout,
  excludedWindowIds = [],
  onEvent = () => {},
  setTimer = setTimeout,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!candidateWindowIds?.length) {
    onEvent("COLD_START_CANDIDATE_REJECTED", { reason: "no-recorded-startup-window" });
    return null;
  }
  const initial = await inspectCandidate(chromeApi, candidateWindowIds, excludedWindowIds);
  if (initial.outcome === "playhouse") {
    onEvent("COLD_START_CANDIDATE_RESOLVED_PLAYHOUSE", {
      tabId: initial.tab.id,
      windowId: initial.window.id,
    });
    return initial;
  }
  if (initial.outcome === "rejected") {
    onEvent("COLD_START_CANDIDATE_REJECTED", { reason: initial.reason });
    return null;
  }

  const candidateWindowId = initial.window.id;
  const candidateTabId = initial.tab.id;
  onEvent("COLD_START_CANDIDATE_FOUND", { tabId: candidateTabId, windowId: candidateWindowId });
  onEvent("COLD_START_CANDIDATE_WAITING", {
    tabId: candidateTabId,
    timeoutMs,
    windowId: candidateWindowId,
  });

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    function cleanup() {
      if (timer !== null) clearTimer(timer);
      chromeApi.tabs.onUpdated.removeListener(handleTabUpdated);
      chromeApi.tabs.onRemoved?.removeListener(handleTabRemoved);
      chromeApi.windows.onRemoved.removeListener(handleWindowRemoved);
    }

    function finish(value) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    async function resolveCurrent(reason) {
      try {
        const result = await inspectCandidate(chromeApi, candidateWindowIds, excludedWindowIds);
        if (settled) return;
        if (result.outcome === "playhouse") {
          onEvent("COLD_START_CANDIDATE_RESOLVED_PLAYHOUSE", {
            reason,
            tabId: result.tab.id,
            windowId: result.window.id,
          });
          finish(result);
        } else if (result.outcome === "rejected") {
          onEvent("COLD_START_CANDIDATE_REJECTED", { reason: result.reason });
          finish(null);
        }
      } catch {
        onEvent("COLD_START_CANDIDATE_REJECTED", { reason: "candidate-inspection-failed" });
        finish(null);
      }
    }

    function handleTabUpdated(tabId, changeInfo) {
      if (tabId !== candidateTabId || settled) return;
      if (isPlayhouseUrl(changeInfo.url)) {
        resolveCurrent("playhouse-url-observed");
      } else if (changeInfo.status === "complete") {
        resolveCurrent("navigation-complete");
      }
    }

    function handleTabRemoved(tabId) {
      if (tabId !== candidateTabId || settled) return;
      onEvent("COLD_START_CANDIDATE_REJECTED", { reason: "candidate-tab-removed" });
      finish(null);
    }

    function handleWindowRemoved(windowId) {
      if (windowId !== candidateWindowId || settled) return;
      onEvent("COLD_START_CANDIDATE_REJECTED", { reason: "candidate-window-removed" });
      finish(null);
    }

    chromeApi.tabs.onUpdated.addListener(handleTabUpdated);
    chromeApi.tabs.onRemoved?.addListener(handleTabRemoved);
    chromeApi.windows.onRemoved.addListener(handleWindowRemoved);
    timer = setTimer(() => {
      onEvent("COLD_START_CANDIDATE_TIMEOUT", {
        tabId: candidateTabId,
        timeoutMs,
        windowId: candidateWindowId,
      });
      finish(null);
    }, timeoutMs);
    resolveCurrent("listeners-attached");
  });
}
