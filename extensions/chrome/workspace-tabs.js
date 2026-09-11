export const AUX_ROLE_URLS = {
  calendar: "https://calendar.google.com/calendar/u/0/r",
  gmail: "https://mail.google.com/mail/u/0/#inbox",
  misc: "https://www.google.com/",
};

const AUX_ROLES = new Set(Object.keys(AUX_ROLE_URLS));

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
    tabs: [{ pinned: false, role: "playhouse", url: playhouseUrl }],
  };
}

export function validSavedTabs(value, kind) {
  if (!value || !Array.isArray(value.tabs) || !value.tabs.length) return null;
  const tabs = value.tabs.flatMap((tab, sourceIndex) => {
    if (!isRestorableTabUrl(tab?.url)) return [];
    const role = kind === "playhouse"
      ? tab.role === "playhouse" ? "playhouse" : null
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
      role: tab.id === primaryTabId ? "playhouse" : roleByTabId.get(tab.id) ?? null,
      url: tab.url,
    })),
  };
}

export function auxRoleForUrl(value) {
  if (!isRestorableTabUrl(value)) return null;
  try {
    return new URL(value).hostname === "mail.google.com" ? "gmail" : "misc";
  } catch {
    return null;
  }
}
