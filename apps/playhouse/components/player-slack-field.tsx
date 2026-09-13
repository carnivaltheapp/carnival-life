"use client";

import { useEffect, useState, useTransition } from "react";

import { loadPlayerSlack, savePlayerSlack } from "../app/players/actions";
import { openInAuxAndWait } from "../lib/desktop/open-in-aux";
import { PLAYER_SLACK_UPDATED_EVENT, usableSlackUrl } from "../lib/google/contact-slack";

export function PlayerSlackField({ playerContactId }: { playerContactId: string | null }) {
  const [confirmed, setConfirmed] = useState("");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(playerContactId));
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    if (!playerContactId) return () => { current = false; };
    void loadPlayerSlack(playerContactId).then((response) => {
      if (!current) return;
      setLoading(false);
      if (response.status === "error") setMessage(response.message);
      else {
        setConfirmed(response.slack);
        setValue(response.slack);
      }
    });
    return () => { current = false; };
  }, [playerContactId]);

  function save() {
    if (!playerContactId || pending || loading || value === confirmed) return;
    const destination = value.trim() ? usableSlackUrl(value) : null;
    if (value.trim() && !destination) {
      setMessage("Enter a valid Slack URL.");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const response = await savePlayerSlack(playerContactId, value);
      if (response.status === "error") {
        setValue(confirmed);
        setMessage(response.message);
        return;
      }
      setConfirmed(response.slack);
      setValue(response.slack);
      window.dispatchEvent(new CustomEvent(PLAYER_SLACK_UPDATED_EVENT, {
        detail: { playerContactId, slack: response.slack },
      }));
      const url = usableSlackUrl(response.slack);
      if (url && !await openInAuxAndWait(url)) {
        setMessage("Slack was saved, but could not be opened in Aux.");
      }
    });
  }

  return (
    <label className="field compactField playerSlackField">
      <span className="srOnly">Slack</span>
      <input
        aria-label="Slack"
        disabled={!playerContactId || loading || pending}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          }
        }}
        placeholder={loading ? "Loading Slack…" : "Slack URL"}
        value={value}
      />
      <button
        aria-label="Save Slack"
        className="playerSlackSaveButton"
        disabled={!playerContactId || loading || pending || value === confirmed}
        onClick={save}
        type="button"
      >
        {pending ? "…" : "Save"}
      </button>
      {message ? <small className="playerSlackError" role="alert">{message}</small> : null}
    </label>
  );
}
