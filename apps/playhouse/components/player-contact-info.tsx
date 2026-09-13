"use client";

import { useState, useTransition } from "react";

import { resolvePlayerContactResourceName } from "../app/players/actions";
import { openInAuxAndWait } from "../lib/desktop/open-in-aux";
import { googleContactUrl } from "../lib/google/contact-navigation";

export function PlayerContactInfo({
  playerContactId,
}: {
  playerContactId: string | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openContact() {
    if (!playerContactId || isPending) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await resolvePlayerContactResourceName(playerContactId);
        const url = response.status === "success"
          ? googleContactUrl(response.resourceName)
          : null;
        if (!url || !await openInAuxAndWait(url)) {
          setMessage(response.status === "error"
            ? response.message
            : "Google Contacts could not be opened in Aux.");
        }
      } catch {
        setMessage("Google Contacts could not be opened in Aux.");
      }
    });
  }

  return (
    <div className="playerContactInfo">
      <button
        aria-label="Open Player in Google Contacts"
        className="playerContactInfoButton"
        disabled={!playerContactId || isPending}
        onClick={openContact}
        title="Open Player in Google Contacts"
        type="button"
      >
        i
      </button>
      {message ? <small className="playerContactInfoError" role="alert">{message}</small> : null}
    </div>
  );
}
