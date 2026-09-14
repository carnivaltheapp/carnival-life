"use client";

import { useEffect, useState } from "react";

import { loadPlayerSlack } from "../app/players/actions";
import {
  PLAYER_SLACK_UPDATED_EVENT,
  slackFieldDisplayValue,
} from "../lib/google/contact-slack";

export function PlayerSlackField({ playerContactId }: { playerContactId: string | null }) {
  const [confirmed, setConfirmed] = useState("");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(Boolean(playerContactId));
  const displayedValue = slackFieldDisplayValue({ editing, resolvedName, url: value });

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
        setResolvedName(response.slackName);
      }
    });
    return () => { current = false; };
  }, [playerContactId]);

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{
        playerContactId: string;
        slack: string;
        slackName?: string | null;
      }>).detail;
      if (detail?.playerContactId !== playerContactId) return;
      setConfirmed(detail.slack);
      setValue(detail.slack);
      setResolvedName(detail.slackName ?? null);
      setEditing(false);
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
        onChange={(event) => {
          setValue(event.target.value);
          setResolvedName(null);
        }}
        onBlur={() => {
          if (value.trim() === confirmed.trim()) setEditing(false);
        }}
        onFocus={() => setEditing(true)}
        placeholder={loading ? "Loading Slack…" : "Slack URL"}
        value={displayedValue}
      />
      <input name="slack" type="hidden" value={value} />
      <input name="slackConfirmed" type="hidden" value={confirmed} />
      {message ? <small className="playerSlackError" role="alert">{message}</small> : null}
    </label>
  );
}
