import { describe, expect, it, vi } from "vitest";

import {
  refreshGoogleAccessToken,
  retainRefreshTokenIfPresent,
} from "./token-broker";

describe("Google token broker", () => {
  it("does not erase a retained token when Google returns no refresh token", async () => {
    const store = vi.fn<(token: string) => Promise<void>>();

    await expect(retainRefreshTokenIfPresent(null, store)).resolves.toBe(false);
    expect(store).not.toHaveBeenCalled();
  });

  it("stores a newly returned refresh token", async () => {
    const store = vi.fn<(token: string) => Promise<void>>().mockResolvedValue();

    await expect(
      retainRefreshTokenIfPresent("new-refresh-token", store),
    ).resolves.toBe(true);
    expect(store).toHaveBeenCalledWith("new-refresh-token");
  });

  it("returns a short-lived access token from the Google token endpoint", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "fresh-access-token" }), {
        status: 200,
      }),
    );

    await expect(
      refreshGoogleAccessToken({
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token",
        request,
      }),
    ).resolves.toEqual({
      accessToken: "fresh-access-token",
      needsReconnect: false,
      success: true,
    });
    const options = request.mock.calls[0]?.[1];
    expect(String(options?.body)).toContain("grant_type=refresh_token");
    expect(String(options?.body)).toContain("refresh_token=refresh-token");
  });

  it("requires reconnect when Google rejects a revoked refresh token", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );

    await expect(
      refreshGoogleAccessToken({
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "revoked-token",
        request,
      }),
    ).resolves.toEqual({ needsReconnect: true, success: false });
  });
});
