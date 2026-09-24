import type { Metadata } from "next";

import { GoogleSignInButton } from "../../../components/google-sign-in-button";
import { PlayHouseIcon } from "../../../components/playhouse-icon";
import { authenticatedDevelopmentOwner } from "../../../lib/development/auth";
import {
  CarnivalRoadmapOAuthService,
  RoadmapOAuthError,
} from "../../../lib/development/roadmap-oauth.server";

export const metadata: Metadata = { title: "Authorize Carnival Roadmap" };
export const dynamic = "force-dynamic";

type SearchParameters = Record<string, string | string[] | undefined>;

function authorizationParameters(search: SearchParameters) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) parameters.set(key, first);
  }
  return parameters;
}

export default async function RoadmapAuthorizationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const parameters = authorizationParameters(await searchParams);
  let authorization = null;
  let error: string | null = null;
  try {
    const issuer = new URL(parameters.get("resource") ?? "").origin;
    authorization = await new CarnivalRoadmapOAuthService().validateAuthorizationRequest(
      issuer,
      parameters,
    );
  } catch (caught) {
    error = caught instanceof RoadmapOAuthError
      ? caught.message
      : "This authorization request is unavailable.";
  }
  const ownerUserId = authorization ? await authenticatedDevelopmentOwner() : null;
  const next = `/oauth/authorize?${parameters.toString()}`;

  return (
    <main className="authPage">
      <header className="authHeader">
        <span className="brand" aria-label="Carnival Life">
          <PlayHouseIcon />
          <span><strong>Carnival</strong><small>Development</small></span>
        </span>
      </header>
      <section className="authCard" aria-labelledby="oauth-consent-title">
        <span className="spark" aria-hidden="true">✦</span>
        <p className="eyebrow">Carnival roadmap access</p>
        <h1 id="oauth-consent-title">Authorize ChatGPT</h1>
        {error ? <p className="authNotice" role="alert">{error}</p> : !ownerUserId ? (
          <>
            <p className="authIntro">
              Sign in with the Carnival account that owns the Development Console roadmap.
            </p>
            <GoogleSignInButton next={next} />
          </>
        ) : (
          <>
            <p className="authIntro">
              ChatGPT is requesting read-only access to your Carnival Development Roadmap.
              It cannot create, edit, delete, move, or reorder roadmap data.
            </p>
            <p className="oauthScopes">Requested permission: roadmap:read</p>
            <form action="/api/oauth/authorize" className="oauthActions" method="post">
              {[...parameters.entries()].map(([name, value]) => (
                <input key={name} name={name} type="hidden" value={value} />
              ))}
              <button name="decision" type="submit" value="allow">Allow</button>
              <button name="decision" type="submit" value="deny">Cancel</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
