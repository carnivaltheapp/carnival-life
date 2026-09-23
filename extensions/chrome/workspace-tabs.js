export const AUX_ROLE_URLS = {
  calendar: "https://calendar.google.com/calendar/u/0/r",
  contacts: "https://contacts.google.com/",
  drive: "https://drive.google.com/drive/my-drive",
  gmail: "https://mail.google.com/mail/u/0/#inbox",
  misc: "https://www.google.com/",
  slack: "https://app.slack.com/",
};

export const HOT_TAB_ROLES = Object.freeze({
  calendar: "calendar",
  drive: "drive",
  gmail: "gmail",
  slack: "slack",
  url: "misc",
});

const AUX_ROLES = new Set(Object.keys(AUX_ROLE_URLS));
const PLAYHOUSE_ORIGIN = "https://carnival-playhouse.vercel.app";

function diagnosticReason(value) {
  const reasons = {
    "tab-activated": "tab_activated",
    "tab-created": "tab_created",
    "tab-load-complete": "tab_updated",
    "tab-moved": "tab_moved",
    "tab-pin-updated": "tab_updated",
    "tab-removed": "tab_removed",
    "tab-url-updated": "tab_updated",
    "window-closing": "window_closing",
  };
  const safeReasons = new Set([
    "active_index_mismatch",
    "active_tab_mismatch",
    "active_update_failed",
    "completed",
    "order_mismatch",
    "pin_count_mismatch",
    "pin_update_failed",
    "restore_in_progress",
    "role_mismatch",
    "snapshot_missing",
    "storage_write_failed",
    "tab_count_mismatch",
    "tab_order_mismatch",
    "window_create_failed",
    "window_id_missing",
    "window_identity_changed",
  ]);
  return reasons[value] ?? (safeReasons.has(value) ? value : "other");
}

async function fingerprint(value, cryptoApi) {
  const bytes = new globalThis.TextEncoder().encode(value);
  const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function tabIdentity(tab, index, activeIndex) {
  try {
    const parsed = new URL(tab.url);
    return {
      active: index === activeIndex,
      hostname: parsed.hostname.toLowerCase(),
      index,
      is_playhouse: parsed.origin === PLAYHOUSE_ORIGIN,
      pinned: tab.pinned === true,
      url: parsed.href,
    };
  } catch {
    return {
      active: index === activeIndex,
      hostname: null,
      index,
      is_playhouse: false,
      pinned: tab.pinned === true,
      url: "invalid",
    };
  }
}

export async function safePhSessionSnapshot(snapshot, cryptoApi = globalThis.crypto) {
  const tabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs : [];
  const activeIndex = Number.isInteger(snapshot?.activeIndex) ? snapshot.activeIndex : -1;
  const identities = tabs.map((tab, index) => tabIdentity(tab, index, activeIndex));
  const safeTabs = await Promise.all(identities.map(async ({ url, ...tab }) => ({
    ...tab,
    url_fingerprint: await fingerprint(url, cryptoApi),
  })));
  return {
    active_index: activeIndex,
    fingerprint_version: "sha256-v1",
    pinned_indexes: safeTabs.filter(({ pinned }) => pinned).map(({ index }) => index),
    snapshot_fingerprint: await fingerprint(JSON.stringify({
      activeIndex,
      tabs: identities.map(({ active: _active, ...tab }) => tab),
    }), cryptoApi),
    tab_count: safeTabs.length,
    tabs: safeTabs,
  };
}

export function createPhSessionDiagnosticTrail({ cryptoApi = globalThis.crypto, record } = {}) {
  let queue = Promise.resolve();

  function emit(event, { actualSnapshot, expectedSnapshot, reason, snapshot, ...details } = {}) {
    queue = queue.then(async () => {
      const safeSnapshot = snapshot ? await safePhSessionSnapshot(snapshot, cryptoApi) : null;
      const safeExpected = expectedSnapshot
        ? await safePhSessionSnapshot(expectedSnapshot, cryptoApi)
        : null;
      const safeActual = actualSnapshot
        ? await safePhSessionSnapshot(actualSnapshot, cryptoApi)
        : null;
      const safeDetails = {
        ...details,
        correlation_id: details.correlation_id ?? safeSnapshot?.snapshot_fingerprint ??
          safeExpected?.snapshot_fingerprint ?? safeActual?.snapshot_fingerprint ?? null,
        ...(reason === undefined ? {} : { reason: diagnosticReason(reason) }),
        ...(safeSnapshot ? { snapshot: safeSnapshot } : {}),
        ...(safeExpected ? { expected_snapshot: safeExpected } : {}),
        ...(safeActual ? { actual_snapshot: safeActual } : {}),
      };
      await record?.(event, safeDetails);
    }).catch(() => {
      // Diagnostics are deliberately non-blocking and must never affect workspace behavior.
    });
    return queue;
  }

  return {
    drain: () => queue,
    record: emit,
  };
}

export function isRestorableTabUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function defaultAuxTabs() {
  return {
    activeIndex: 0,
    tabs: [
      { pinned: false, role: "calendar", url: AUX_ROLE_URLS.calendar },
      { pinned: false, role: "gmail", url: AUX_ROLE_URLS.gmail },
      { pinned: false, role: "misc", url: AUX_ROLE_URLS.misc },
    ],
  };
}

export function defaultPlayhouseTabs(playhouseUrl) {
  return {
    activeIndex: 0,
    tabs: [{ pinned: false, role: "ph-primary", url: playhouseUrl }],
  };
}

export function validSavedTabs(value, kind) {
  if (!value || !Array.isArray(value.tabs) || !value.tabs.length) return null;
  const tabs = value.tabs.flatMap((tab, sourceIndex) => {
    if (!isRestorableTabUrl(tab?.url)) return [];
    const role = kind === "playhouse"
      ? tab.role === "ph-primary" || tab.role === "playhouse" ? "ph-primary" : null
      : AUX_ROLES.has(tab.role) ? tab.role : null;
    return [{ pinned: tab.pinned === true, role, sourceIndex, url: tab.url }];
  });
  if (!tabs.length) return null;
  const requestedActiveIndex = Number.isInteger(value.activeIndex)
    ? Math.max(0, Math.min(value.activeIndex, value.tabs.length - 1))
    : 0;
  const activeIndex = tabs.findIndex((tab) => tab.sourceIndex === requestedActiveIndex);
  return {
    activeIndex: Math.max(0, activeIndex),
    tabs: tabs.map((tab) => ({ pinned: tab.pinned, role: tab.role, url: tab.url })),
  };
}

export function snapshotTabs(tabs, roleTabIds = {}, primaryTabId = null) {
  const ordered = [...tabs]
    .filter((tab) => isRestorableTabUrl(tab.url))
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  if (!ordered.length) return null;
  const roleByTabId = new Map(
    Object.entries(roleTabIds).map(([role, tabId]) => [tabId, role]),
  );
  const activeTabId = ordered.find((tab) => tab.active)?.id;
  return {
    activeIndex: Math.max(0, ordered.findIndex((tab) => tab.id === activeTabId)),
    tabs: ordered.map((tab) => ({
      pinned: tab.pinned === true,
      role: tab.id === primaryTabId ? "ph-primary" : roleByTabId.get(tab.id) ?? null,
      url: tab.url,
    })),
  };
}

export function auxRoleForUrl(value) {
  if (!isRestorableTabUrl(value)) return null;
  try {
    const host = new URL(value).hostname;
    if (host === "calendar.google.com") return "calendar";
    if (host === "mail.google.com") return "gmail";
    if (host === "drive.google.com") return "drive";
    if (isGoogleContactsUrl(value)) return "contacts";
    if (isSlackUrl(value)) return "slack";
    return "misc";
  } catch {
    return null;
  }
}

export function isSlackUrl(value) {
  if (!isRestorableTabUrl(value)) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "slack.com" || host.endsWith(".slack.com");
  } catch {
    return false;
  }
}

export function isGoogleContactsUrl(value) {
  if (!isRestorableTabUrl(value)) return false;
  try {
    return new URL(value).hostname === "contacts.google.com";
  } catch {
    return false;
  }
}
