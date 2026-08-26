const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type GoogleTokenRefreshResult =
  | { accessToken: string; needsReconnect: false; success: true }
  | { needsReconnect: boolean; success: false };

export async function retainRefreshTokenIfPresent(
  providerRefreshToken: string | null | undefined,
  store: (refreshToken: string) => Promise<void>,
) {
  if (!providerRefreshToken) {
    return false;
  }

  await store(providerRefreshToken);
  return true;
}

export async function refreshGoogleAccessToken({
  clientId,
  clientSecret,
  refreshToken,
  request = fetch,
}: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  request?: typeof fetch;
}): Promise<GoogleTokenRefreshResult> {
  const response = await request(GOOGLE_TOKEN_ENDPOINT, {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    error?: unknown;
  };

  if (response.ok && typeof body.access_token === "string") {
    return {
      accessToken: body.access_token,
      needsReconnect: false,
      success: true,
    };
  }

  return {
    needsReconnect: body.error === "invalid_grant" || response.status === 401,
    success: false,
  };
}
