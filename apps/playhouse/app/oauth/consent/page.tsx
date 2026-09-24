import type { Metadata } from "next";

import { GoogleSignInButton } from "../../../components/google-sign-in-button";
import { PlayHouseIcon } from "../../../components/playhouse-icon";
import { createClient } from "../../../lib/supabase/server";
import { OAuthConsent } from "./oauth-consent";

export const metadata: Metadata = { title: "Authorize Carnival Roadmap" };
export const dynamic = "force-dynamic";

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const authorizationId = (await searchParams).authorization_id?.trim() ?? "";
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;

  return (
    <main className="authPage">
      <header className="authHeader">
        <span className="brand" aria-label="Carnival Life">
          <PlayHouseIcon />
          <span><strong>Carnival</strong><small>Development</small></span>
        </span>
      </header>
      {!authorizationId ? (
        <section className="authCard"><p className="authNotice" role="alert">Authorization request missing.</p></section>
      ) : data?.claims ? (
        <OAuthConsent authorizationId={authorizationId} />
      ) : (
        <section className="authCard" aria-labelledby="oauth-sign-in-title">
          <span className="spark" aria-hidden="true">✦</span>
          <p className="eyebrow">Carnival roadmap access</p>
          <h1 id="oauth-sign-in-title">Sign in to authorize</h1>
          <p className="authIntro">Sign in with the Carnival account that owns the Development Console roadmap.</p>
          <GoogleSignInButton next={next} />
        </section>
      )}
    </main>
  );
}
