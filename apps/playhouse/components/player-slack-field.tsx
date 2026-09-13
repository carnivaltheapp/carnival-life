"use client";

import { useEffect, useState } from "react";

import { loadPlayerSlack } from "../app/players/actions";
import { PLAYER_SLACK_UPDATED_EVENT } from "../lib/google/contact-slack";

export function PlayerSlackField({ playerContactId }: { playerContactId: string | null }) {
  const [confirmed, setConfirmed] = useState("");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(playerContactId));

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

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ playerContactId: string; slack: string }>).detail;
      if (detail?.playerContactId !== playerContactId) return;
      setConfirmed(detail.slack);
      setValue(detail.slack);
      setMessage(null);
    };
    window.addEventListener(PLAYER_SLACK_UPDATED_EVENT, update);
    return () => window.removeEventListener(PLAYER_SLACK_UPDATED_EVENT, update);
  }, [playerContactId]);

  return (
    <label className="field compactField playerSlackField">
      <span className="srOnly">Slack</span>
      <input
        aria-label="Slack"
        disabled={!playerContactId || loading}
        name="slack"
        onChange={(event) => setValue(event.target.value)}
        placeholder={loading ? "Loading Slack…" : "Slack URL"}
        value={value}
      />
      <input name="slackConfirmed" type="hidden" value={confirmed} />
      {message ? <small className="playerSlackError" role="alert">{message}</small> : null}
    </label>
  );
}
