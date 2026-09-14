import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { fetchSlackResourceName, SlackNameCache, SlackReconnectRequiredError } from "./api";
import { decryptSlackAccessToken, encryptSlackAccessToken } from "./credential-crypto";
import {
  hasRequiredSlackScopes,
  parseSlackOAuthResponse,
  slackAuthorizationUrl,
  slackConnectionNeedsReconnect,
  validSlackOAuthState,
} from "./oauth";
import { parseSlackResource } from "./resource";

const ALL_SCOPES = "channels:read,groups:read,im:read,mpim:read,users:read";
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body));

describe("Slack OAuth foundation", () => {
  it("requests exactly the five approved user scopes and no bot scopes", () => {
    const url = new URL(slackAuthorizationUrl({
      clientId: "client",
      redirectUri: "https://example.test/slack/callback",
      state: "csrf",
    }));
    expect(url.searchParams.get("user_scope")).toBe(ALL_SCOPES);
    expect(url.searchParams.get("scope")).toBeNull();
    expect(url.searchParams.get("state")).toBe("csrf");
    expect(hasRequiredSlackScopes(ALL_SCOPES)).toBe(true);
    expect(hasRequiredSlackScopes("channels:read,users:read")).toBe(false);
  });

  it("requires reconnect for an old two-scope connection", () => {
    expect(slackConnectionNeedsReconnect("connected", ["channels:read", "users:read"]))
      .toBe(true);
    expect(slackConnectionNeedsReconnect("connected", ALL_SCOPES.split(","))).toBe(false);
    expect(slackConnectionNeedsReconnect("error", ALL_SCOPES.split(","))).toBe(true);
  });

  it("validates state and the five-scope user-token exchange response", () => {
    expect(validSlackOAuthState("same", "same")).toBe(true);
    expect(validSlackOAuthState("wrong", "state")).toBe(false);
    expect(parseSlackOAuthResponse({
      ok: true,
      authed_user: { access_token: "xoxp-secret", id: "U1", scope: ALL_SCOPES },
      team: { id: "T1", name: "Carnival" },
    })).toEqual({
      accessToken: "xoxp-secret",
      grantedScopes: ALL_SCOPES.split(","),
      slackUserId: "U1",
      teamId: "T1",
      teamName: "Carnival",
    });
    expect(parseSlackOAuthResponse({
      ok: true,
      authed_user: { access_token: "xoxp-secret", id: "U1", scope: "channels:read,users:read" },
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
    ["https://app.slack.com/client/T123/C456", { id: "C456", teamId: "T123", type: "conversation" }],
    ["https://app.slack.com/client/T123/G456", { id: "G456", teamId: "T123", type: "conversation" }],
    ["https://app.slack.com/client/T123/D456", { id: "D456", teamId: "T123", type: "conversation" }],
    ["https://acme.slack.com/archives/C456/p123", { id: "C456", teamId: null, type: "conversation" }],
    ["https://acme.slack.com/archives/G456?selected_team_id=T999", { id: "G456", teamId: "T999", type: "conversation" }],
    ["https://app.slack.com/team/T123/U456", { id: "U456", teamId: "T123", type: "user" }],
    ["https://acme.slack.com/team/U456?selected_team_id=T999", { id: "U456", teamId: "T999", type: "user" }],
  ])("parses %s", (value, expected) => expect(parseSlackResource(value)).toEqual(expected));

  it.each([
    "https://app.slack.com/client/not-a-team/C456",
    "https://app.slack.com/client/T123/U456",
    "https://example.com/team/U456",
  ])("rejects unsupported or unrelated URLs", (value) => expect(parseSlackResource(value)).toBeNull());
});

describe("Slack live resolver", () => {
  it("resolves public and private conversation names from conversations.info", async () => {
    const publicFetch = vi.fn(async (input: URL | RequestInfo) => {
      void input;
      return jsonResponse({
        ok: true,
        channel: { is_channel: true, is_private: false, name: "launch" },
      });
    });
    const privateFetch = vi.fn(async (input: URL | RequestInfo) => {
      void input;
      return jsonResponse({
        ok: true,
        channel: { is_channel: true, is_private: true, name: "leadership" },
      });
    });
    const resource = { id: "C1", teamId: "T1", type: "conversation" } as const;
    await expect(fetchSlackResourceName("token", resource, "USELF", publicFetch as typeof fetch))
      .resolves.toBe("#launch");
    await expect(fetchSlackResourceName("token", resource, "USELF", privateFetch as typeof fetch))
      .resolves.toBe("🔒 leadership");
    expect(new URL(String(publicFetch.mock.calls[0][0])).pathname).toBe("/api/conversations.info");
  });

  it("resolves a D conversation through conversations.info then users.info", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        channel: { is_im: true, members: ["USELF", "UOTHER"], user: "UOTHER" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        user: { profile: { display_name: "Joshua", real_name: "Joshua Ruskin" } },
      }));
    await expect(fetchSlackResourceName(
      "token",
      { id: "D1", teamId: "T1", type: "conversation" },
      "USELF",
      request as typeof fetch,
    )).resolves.toBe("Joshua");
    expect((request.mock.calls as Array<[URL]>).map(([url]) => url.pathname)).toEqual([
      "/api/conversations.info",
      "/api/users.info",
    ]);
  });

  it("resolves MPIM participants and excludes the authenticated Slack user", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        channel: { is_mpim: true, members: ["USELF", "U1", "U2"] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        user: { profile: { display_name: "Joshua" } },
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        user: { profile: { display_name: "David" } },
      }));
    await expect(fetchSlackResourceName(
      "token",
      { id: "G1", teamId: "T1", type: "conversation" },
      "USELF",
      request as typeof fetch,
    )).resolves.toBe("Joshua, David");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("keeps resolvable MPIM participants when another lookup fails", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        channel: { is_mpim: true, members: ["USELF", "U1", "U2"] },
      }))
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        user: { profile: { display_name: "David" } },
      }));
    await expect(fetchSlackResourceName(
      "token",
      { id: "G1", teamId: "T1", type: "conversation" },
      "USELF",
      request as typeof fetch,
    )).resolves.toBe("David");
  });

  it("resolves direct user URLs and falls back to real name", async () => {
    const request = vi.fn(async (input: URL | RequestInfo) => {
      void input;
      return jsonResponse({
        ok: true,
        user: { profile: { display_name: "", real_name: "Ada Lovelace" } },
      });
    });
    await expect(fetchSlackResourceName(
      "token",
      { id: "U1", teamId: "T1", type: "user" },
      "USELF",
      request as typeof fetch,
    )).resolves.toBe("Ada Lovelace");
    expect(new URL(String(request.mock.calls[0][0])).pathname).toBe("/api/users.info");
  });

  it("marks revoked authorization as requiring reconnect", async () => {
    const request = vi.fn(async () => jsonResponse({ ok: false, error: "token_revoked" }));
    await expect(fetchSlackResourceName(
      "token",
      { id: "U1", teamId: "T1", type: "user" },
      "USELF",
      request as typeof fetch,
    )).rejects.toBeInstanceOf(SlackReconnectRequiredError);
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
