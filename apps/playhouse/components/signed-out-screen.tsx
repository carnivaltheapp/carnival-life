import { GoogleSignInButton } from "./google-sign-in-button";

export function SignedOutScreen({
  authError,
  configurationMissing,
}: {
  authError: boolean;
  configurationMissing: boolean;
}) {
  return (
    <main className="authPage">
      <header className="authHeader">
        <span className="brand" aria-label="Carnival PlayHouse">
          <span className="brandMark" aria-hidden="true">
            C
          </span>
          <span>
            <strong>Carnival</strong>
            <small>PlayHouse</small>
          </span>
        </span>
      </header>

      <section className="authCard" aria-labelledby="sign-in-title">
        <span className="spark" aria-hidden="true">
          ✦
        </span>
        <p className="eyebrow">Welcome to Carnival Life</p>
        <h1 id="sign-in-title">Carnival PlayHouse</h1>
        <p className="authIntro">
          Sign in to see your calendar destinations, Baskets, and Plays.
        </p>

        {configurationMissing ? (
          <p className="authNotice" role="alert">
            PlayHouse authentication is not configured in this environment.
          </p>
        ) : (
          <GoogleSignInButton />
        )}

        {authError ? (
          <p className="authNotice" role="alert">
            Authentication could not be completed. Please try signing in again.
          </p>
        ) : null}
      </section>
    </main>
  );
}
