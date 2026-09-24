"use client";

import { useEffect, useState } from "react";

import { createClient } from "../../../lib/supabase/client";

type AuthorizationDetails = {
  authorization_id: string;
  client: { name: string; uri: string };
  scope: string;
};

export function OAuthConsent({ authorizationId }: { authorizationId: string }) {
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void createClient().auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (!active) return;
      if (error || !data) {
        setError("This authorization request is unavailable or has expired.");
      } else if ("redirect_url" in data) {
        window.location.assign(data.redirect_url);
      } else {
        setDetails(data);
      }
    });
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approved: boolean) {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const response = approved
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (response.error || !response.data?.redirect_url) {
      setError("The authorization decision could not be completed.");
      setPending(false);
      return;
    }
    window.location.assign(response.data.redirect_url);
  }

  return (
    <section className="authCard" aria-labelledby="oauth-consent-title">
      <span className="spark" aria-hidden="true">✦</span>
      <p className="eyebrow">Carnival roadmap access</p>
      <h1 id="oauth-consent-title">Authorize ChatGPT</h1>
      {details ? (
        <>
          <p className="authIntro">
            <strong>{details.client.name}</strong> is requesting read-only access to your current
            Development Console roadmap. It cannot create, edit, delete, move, or reorder data.
          </p>
          <p className="oauthScopes">Requested identity scopes: {details.scope}</p>
          <div className="oauthActions">
            <button disabled={pending} onClick={() => void decide(true)} type="button">Allow</button>
            <button disabled={pending} onClick={() => void decide(false)} type="button">Deny</button>
          </div>
        </>
      ) : error ? null : <p className="authIntro">Loading authorization request…</p>}
      {error ? <p className="authNotice" role="alert">{error}</p> : null}
    </section>
  );
}
