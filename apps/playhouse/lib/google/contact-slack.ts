export const PLAYER_SLACK_UPDATED_EVENT = "playhouse:player-slack-updated";

export function changedPlayerSlackFromFormData(formData: FormData) {
  const playerContactId = formData.get("playerContactId");
  const slack = formData.get("slack");
  const confirmedSlack = formData.get("slackConfirmed");
  if (
    typeof playerContactId !== "string" || !playerContactId ||
    typeof slack !== "string" || typeof confirmedSlack !== "string" ||
    slack.trim() === confirmedSlack.trim()
  ) return null;
  return { playerContactId, slack };
}

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

export function slackFieldDisplayValue({
  editing,
  resolvedName,
  url,
}: {
  editing: boolean;
  resolvedName: string | null;
  url: string;
}) {
  return editing ? url : resolvedName || url;
}
