export const AUX_ROLE_URLS = {
  calendar: "https://calendar.google.com/calendar/u/0/r",
  contacts: "https://contacts.google.com/",
  drive: "https://drive.google.com/drive/my-drive",
  gmail: "https://mail.google.com/mail/u/0/#inbox",
  misc: "https://www.google.com/",
  slack: "https://app.slack.com/",
};

export const HOT_TAB_ROLES = Object.freeze({
  drive: "drive",
  gmail: "gmail",
  slack: "slack",
  url: "misc",
});

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
