export type SlackResource = {
  teamId: string | null;
  type: "channel" | "user";
  id: string;
};

export function parseSlackResource(value: string | null | undefined): SlackResource | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (host !== "slack.com" && !host.endsWith(".slack.com")) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const client = parts.indexOf("client");
  if (host === "app.slack.com" && client >= 0) {
    const teamId = parts[client + 1] ?? "";
    const id = parts[client + 2] ?? "";
    if (/^T[A-Z0-9]+$/i.test(teamId) && /^C[A-Z0-9]+$/i.test(id)) {
      return { teamId, type: "channel", id };
    }
  }
  const archives = parts.indexOf("archives");
  if (archives >= 0 && /^C[A-Z0-9]+$/i.test(parts[archives + 1] ?? "")) {
    return { teamId: null, type: "channel", id: parts[archives + 1] };
  }
  const team = parts.indexOf("team");
  if (team >= 0) {
    const hasTeamId = /^T[A-Z0-9]+$/i.test(parts[team + 1] ?? "");
    const id = parts[team + (hasTeamId ? 2 : 1)] ?? "";
    if (/^(U|W)[A-Z0-9]+$/i.test(id)) {
      return { teamId: hasTeamId ? parts[team + 1] : null, type: "user", id };
    }
  }
  return null;
}
