import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { fetchSlackResourceName, SlackNameCache, SlackReconnectRequiredError } from "./api";
import { decryptSlackAccessToken, encryptSlackAccessToken } from "./credential-crypto";
import {
  hasRequiredSlackScopes,
  parseSlackOAuthResponse,
  slackAuthorizationUrl,
  validSlackOAuthState,
} from "./oauth";
import { parseSlackResource } from "./resource";

describe("Slack OAuth foundation", () => {
  it("requests only the approved user scopes", () => {
    const url = new URL(slackAuthorizationUrl({ clientId: "client", redirectUri: "https://example.test/slack/callback", state: "csrf" }));
    expect(url.searchParams.get("user_scope")).toBe("channels:read,users:read");
    expect(url.searchParams.get("scope")).toBeNull();
    expect(url.searchParams.get("state")).toBe("csrf");
    expect(hasRequiredSlackScopes("channels:read,users:read")).toBe(true);
    expect(hasRequiredSlackScopes("users:read")).toBe(false);
  });

  it("validates state and the user-token exchange response", () => {
    expect(validSlackOAuthState("same", "same")).toBe(true);
    expect(validSlackOAuthState("wrong", "state")).toBe(false);
    expect(parseSlackOAuthResponse({
      ok: true,
      authed_user: { access_token: "xoxp-secret", id: "U1", scope: "channels:read,users:read" },
      team: { id: "T1", name: "Carnival" },
    })).toEqual({
      accessToken: "xoxp-secret",
      grantedScopes: ["channels:read", "users:read"],
      slackUserId: "U1",
      teamId: "T1",
      teamName: "Carnival",
    });
    expect(parseSlackOAuthResponse({
      ok: true,
      authed_user: { access_token: "xoxp-secret", id: "U1", scope: "users:read" },
      team: { id: "T1", name: "Carnival" },
    })).toBeNull();
  });

  it("encrypts a Slack token at rest", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptSlackAccessToken("xoxp-secret", key);
    expect(encrypted.encryptedAccessToken).not.toContain("xoxp-secret");
    expect(decryptSlackAccessToken(encrypted, key)).toBe("xoxp-secret");
  });
});

describe("Slack stable URL parsing", () => {
  it.each([
    ["https://app.slack.com/client/T123/C456", { id: "C456", teamId: "T123", type: "channel" }],
    ["https://acme.slack.com/archives/C456/p123", { id: "C456", teamId: null, type: "channel" }],
    ["https://app.slack.com/team/T123/U456", { id: "U456", teamId: "T123", type: "user" }],
    ["https://acme.slack.com/team/U456", { id: "U456", teamId: null, type: "user" }],
  ])("parses %s", (value, expected) => expect(parseSlackResource(value)).toEqual(expected));

  it.each([
    "https://app.slack.com/client/T123/G456",
    "https://app.slack.com/client/T123/D456",
    "https://example.com/team/U456",
  ])("rejects unsupported or unrelated URLs", (value) => expect(parseSlackResource(value)).toBeNull());
});

describe("Slack live resolver", () => {
  it("resolves public channel and user display names", async () => {
    const channelFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, channel: { is_channel: true, is_private: false, name: "launch" } })));
    const userFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, user: { profile: { display_name: "Ada", real_name: "Ada Lovelace" } } })));
    await expect(fetchSlackResourceName("token", { id: "C1", teamId: "T1", type: "channel" }, channelFetch as typeof fetch)).resolves.toBe("#launch");
    await expect(fetchSlackResourceName("token", { id: "U1", teamId: "T1", type: "user" }, userFetch as typeof fetch)).resolves.toBe("Ada");
  });

  it("falls back to a user's real name", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      user: { profile: { display_name: "", real_name: "Ada Lovelace" } },
    })));
    await expect(fetchSlackResourceName(
      "token",
      { id: "U1", teamId: "T1", type: "user" },
      request as typeof fetch,
    )).resolves.toBe("Ada Lovelace");
  });

  it("marks revoked authorization as requiring reconnect", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "token_revoked" })));
    await expect(fetchSlackResourceName("token", { id: "U1", teamId: "T1", type: "user" }, request as typeof fetch)).rejects.toBeInstanceOf(SlackReconnectRequiredError);
  });

  it("caches names transiently by key until expiry", async () => {
    let now = 100;
    const cache = new SlackNameCache(600, () => now);
    const load = vi.fn(async () => "Ada");
    await cache.get("T1:user:U1", load);
    await cache.get("T1:user:U1", load);
    expect(load).toHaveBeenCalledTimes(1);
    now = 701;
    await cache.get("T1:user:U1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
