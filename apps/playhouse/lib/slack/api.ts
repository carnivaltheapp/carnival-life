import type { SlackResource } from "./resource";

export class SlackReconnectRequiredError extends Error {}

type SlackResponse = {
  ok?: boolean;
  error?: string;
  channel?: { is_channel?: boolean; is_private?: boolean; name?: string };
  user?: { name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string } };
};

export async function fetchSlackResourceName(
  token: string,
  resource: SlackResource,
  request: typeof fetch = fetch,
) {
  const endpoint = resource.type === "channel" ? "conversations.info" : "users.info";
  const parameter = resource.type === "channel" ? "channel" : "user";
  const url = new URL(`https://slack.com/api/${endpoint}`);
  url.searchParams.set(parameter, resource.id);
  const response = await request(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json() as SlackResponse;
  if (!body.ok) {
    if (["invalid_auth", "token_revoked", "account_inactive", "not_authed"].includes(body.error ?? "")) {
      throw new SlackReconnectRequiredError("Reconnect Slack to resolve names.");
    }
    return null;
  }
  if (resource.type === "channel") {
    if (!body.channel?.is_channel || body.channel.is_private || !body.channel.name) return null;
    return `#${body.channel.name}`;
  }
  return body.user?.profile?.display_name?.trim() ||
    body.user?.profile?.real_name?.trim() || body.user?.real_name?.trim() ||
    body.user?.name?.trim() || null;
}

export class SlackNameCache {
  private readonly values = new Map<string, { expiresAt: number; value: string | null }>();
  constructor(private readonly ttlMs = 10 * 60 * 1000, private readonly now = Date.now) {}
  async get(key: string, load: () => Promise<string | null>) {
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const value = await load();
    this.values.set(key, { expiresAt: this.now() + this.ttlMs, value });
    return value;
  }
}
