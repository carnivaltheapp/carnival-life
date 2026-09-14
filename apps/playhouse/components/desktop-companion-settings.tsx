"use client";

import { useEffect, useState } from "react";

import {
  generateCompanionPairingCode,
  listCompanionDevices,
  revokeCompanionDevice,
} from "../app/companion/actions";

type Device = Awaited<ReturnType<typeof listCompanionDevices>>["devices"][number];

export function DesktopCompanionSettings() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const result = await listCompanionDevices();
    setDevices(result.devices);
    setMessage(result.error);
  }

  useEffect(() => {
    let active = true;
    void listCompanionDevices().then((result) => {
      if (!active) return;
      setDevices(result.devices);
      setMessage(result.error);
    });
    return () => { active = false; };
  }, []);

  return (
    <section aria-labelledby="desktop-companion-heading" className="desktopCompanionSettings">
      <h2 id="desktop-companion-heading">Desktop Companion</h2>
      <button
        onClick={() => void generateCompanionPairingCode().then((result) => {
          setPairingCode(result.code);
          setMessage(result.error);
        })}
        type="button"
      >
        Pair device
      </button>
      {pairingCode ? (
        <p>
          Pairing code: <strong>{pairingCode}</strong><br />
          Run the installed companion with <code>--pair {pairingCode}</code>. Code expires in 10 minutes.
        </p>
      ) : null}
      {devices.map((device) => (
        <div className="companionDevice" key={device.device_id}>
          <span>
            <strong>{device.device_name}</strong>
            <small>{device.status} · {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : "Never seen"}</small>
          </span>
          <button
            disabled={device.status === "revoked"}
            onClick={() => void revokeCompanionDevice(device.device_id).then(refresh)}
            type="button"
          >
            Revoke
          </button>
        </div>
      ))}
      {message ? <p role="alert">{message}</p> : null}
    </section>
  );
}
