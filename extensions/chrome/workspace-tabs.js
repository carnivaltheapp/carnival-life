export const AUX_ROLE_URLS = {
  calendar: "https://calendar.google.com/calendar/u/0/r",
  contacts: "https://contacts.google.com/",
  gmail: "https://mail.google.com/mail/u/0/#inbox",
  play: "https://www.google.com/",
  slack: "https://app.slack.com/",
};

export const HOT_TAB_ROLES = Object.freeze({
  calendar: "calendar",
  contacts: "contacts",
  gmail: "gmail",
  play: "play",
  slack: "slack",
});

export const AUX_ROLE_ORDER = Object.freeze([
  "calendar",
  "gmail",
  "contacts",
  "slack",
  "play",
]);

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
    tabs: AUX_ROLE_ORDER.map((role) => ({
      pinned: false,
      role,
      url: AUX_ROLE_URLS[role],
    })),
  };
}

export function defaultMiscTabs() {
  return {
    activeIndex: 0,
    tabs: [{ pinned: false, role: null, url: "https://www.google.com/" }],
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
      : kind === "misc"
        ? null
        : AUX_ROLES.has(tab.role)
          ? tab.role
          : tab.role === "misc" || tab.role === "drive" ? "play" : null;
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
    if (isGoogleContactsUrl(value)) return "contacts";
    if (isSlackUrl(value)) return "slack";
    return "play";
  } catch {
    return null;
  }
}

export function isUrlForAuxRole(value, role) {
  if (!AUX_ROLE_ORDER.includes(role) || !isRestorableTabUrl(value)) return false;
  return role === "play" ? !["calendar", "contacts", "gmail", "slack"].includes(auxRoleForUrl(value))
    : auxRoleForUrl(value) === role;
}

export function canonicalAuxTabs(savedTabs) {
  const saved = validSavedTabs(savedTabs, "context");
  const byRole = new Map((saved?.tabs ?? []).flatMap((tab) => (
    tab.role && isUrlForAuxRole(tab.url, tab.role) ? [[tab.role, tab]] : []
  )));
  const activeRole = saved?.tabs[saved.activeIndex]?.role ?? "calendar";
  const tabs = AUX_ROLE_ORDER.map((role) => ({
    pinned: false,
    role,
    url: byRole.get(role)?.url ?? AUX_ROLE_URLS[role],
  }));
  return {
    activeIndex: Math.max(0, AUX_ROLE_ORDER.indexOf(activeRole)),
    tabs,
  };
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
