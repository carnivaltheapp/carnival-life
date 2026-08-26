"use client";

import { useState } from "react";

import { createClient } from "../lib/supabase/client";

export function GoogleSignInButton() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function signIn() {
    setErrorMessage(null);
    setIsPending(true);

    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=/`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          queryParams: {
            access_type: "offline",
            include_granted_scopes: "true",
            prompt: "consent",
          },
          redirectTo,
          scopes: "https://www.googleapis.com/auth/contacts.readonly",
        },
      });

      if (error) {
        setErrorMessage("Google sign-in could not be started. Please try again.");
        setIsPending(false);
      }
    } catch {
      setErrorMessage("Google sign-in is temporarily unavailable.");
      setIsPending(false);
    }
  }

  return (
    <div className="signInAction">
      <button
        className="googleButton"
        disabled={isPending}
        onClick={signIn}
        type="button"
      >
        <span className="googleMark" aria-hidden="true">
          G
        </span>
        {isPending ? "Opening Google…" : "Sign in with Google"}
      </button>
      {errorMessage ? <p className="formError" role="alert">{errorMessage}</p> : null}
    </div>
  );
}
