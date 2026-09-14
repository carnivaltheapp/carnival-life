import type { SlackResource } from "./resource";

export class SlackReconnectRequiredError extends Error {}

type SlackUser = {
  name?: string;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string };
};

type SlackConversation = {
  is_channel?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  members?: string[];
  name?: string;
  user?: string;
};

type SlackResponse = {
  ok?: boolean;
  error?: string;
  channel?: SlackConversation;
  user?: SlackUser;
};

const RECONNECT_ERRORS = ["invalid_auth", "token_revoked", "account_inactive", "not_authed"];

function slackUserName(user: SlackUser | undefined) {
  return user?.profile?.display_name?.trim() || user?.profile?.real_name?.trim() ||
    user?.real_name?.trim() || user?.name?.trim() || null;
}

async function slackApiRequest(
  token: string,
  endpoint: "conversations.info" | "users.info",
  parameter: "channel" | "user",
  id: string,
  request: typeof fetch,
) {
  const url = new URL(`https://slack.com/api/${endpoint}`);
  url.searchParams.set(parameter, id);
  const response = await request(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json() as SlackResponse;
  if (!body.ok) {
    if (RECONNECT_ERRORS.includes(body.error ?? "")) {
      throw new SlackReconnectRequiredError("Reconnect Slack to resolve names.");
    }
    return null;
  }
  return body;
}

async function resolveUserName(token: string, userId: string, request: typeof fetch) {
  const body = await slackApiRequest(token, "users.info", "user", userId, request);
  return slackUserName(body?.user);
}

async function resolveParticipantNames(
  token: string,
  userIds: string[],
  request: typeof fetch,
) {
  const names: string[] = [];
  for (const userId of userIds) {
    try {
      const name = await resolveUserName(token, userId, request);
      if (name) names.push(name);
    } catch (error) {
      if (error instanceof SlackReconnectRequiredError) throw error;
    }
  }
  return names;
}

export async function fetchSlackResourceName(
  token: string,
  resource: SlackResource,
  authenticatedSlackUserId: string,
  request: typeof fetch = fetch,
) {
  if (resource.type === "user") {
    return resolveUserName(token, resource.id, request);
  }

  const body = await slackApiRequest(
    token,
    "conversations.info",
    "channel",
    resource.id,
    request,
  );
  const conversation = body?.channel;
  if (!conversation) return null;

  if (conversation.is_im) {
    const counterpartId = conversation.user && conversation.user !== authenticatedSlackUserId
      ? conversation.user
      : conversation.members?.find((id) => id !== authenticatedSlackUserId);
    return counterpartId ? resolveUserName(token, counterpartId, request) : null;
  }

  if (conversation.is_mpim) {
    const participantIds = (conversation.members ?? []).filter(
      (id) => id !== authenticatedSlackUserId,
    );
    const names = await resolveParticipantNames(token, participantIds, request);
    return names.length ? names.join(", ") : null;
  }

  if (!conversation.name) return null;
  return conversation.is_private ? `🔒 ${conversation.name}` : `#${conversation.name}`;
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
