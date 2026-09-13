export const PLAYER_SLACK_UPDATED_EVENT = "playhouse:player-slack-updated";

export function usableSlackUrl(value: string | null | undefined) {
  const entered = value?.trim();
  if (!entered) return null;
  try {
    const url = new URL(entered);
    const host = url.hostname.toLowerCase();
    return (url.protocol === "https:" || url.protocol === "http:") &&
      (host === "slack.com" || host.endsWith(".slack.com"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
