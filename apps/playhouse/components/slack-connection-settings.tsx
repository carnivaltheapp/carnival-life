"use client";

import { useEffect, useState } from "react";

import { loadSlackConnectionStatus, type SlackConnectionStatus } from "../app/slack/actions";

export function SlackConnectionSettings() {
  const [status, setStatus] = useState<SlackConnectionStatus | null>(null);
  useEffect(() => { void loadSlackConnectionStatus().then(setStatus); }, []);
  return (
    <section aria-labelledby="slack-settings-heading" className="slackConnectionSettings">
      <h2 id="slack-settings-heading">Slack</h2>
      {status?.teamName ? (
        <p><strong>{status.teamName}</strong><span>{status.connected ? "Connected" : "Reconnect required"}</span></p>
      ) : (
        <p>{status ? "Slack is not connected." : "Loading Slack connection…"}</p>
      )}
      <a className="slackConnectButton" href="/slack/connect">
        {status?.teamName ? "Reconnect Slack" : "Connect Slack"}
      </a>
    </section>
  );
}
