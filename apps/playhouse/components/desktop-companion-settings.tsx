"use client";

import { useEffect, useState } from "react";

import {
  generateCompanionPairingCode,
  getCompanionFolderCreationStatus,
  listCompanionDevices,
  listCompanionFolderOptions,
  requestCompanionFolderCreation,
  revokeCompanionDevice,
} from "../app/companion/actions";

type Device = Awaited<ReturnType<typeof listCompanionDevices>>["devices"][number];

export function DesktopCompanionSettings() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [folderName, setFolderName] = useState("");
  const [parentFolder, setParentFolder] = useState("");
  const [makeBranch, setMakeBranch] = useState(false);
  const [creating, setCreating] = useState(false);

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
    void listCompanionFolderOptions().then((result) => {
      if (active) setFolders(result.folders);
    });
    return () => { active = false; };
  }, []);

  async function createFolder() {
    setCreating(true);
    setMessage(null);
    const request = await requestCompanionFolderCreation({
      isBranch: makeBranch,
      name: folderName,
      parentRelativePath: parentFolder,
    });
    if (!request.commandId) {
      setMessage(request.error);
      setCreating(false);
      return;
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      const status = await getCompanionFolderCreationStatus(request.commandId);
      if (status.status === "completed") {
        setMessage(`Folder created: ${status.relativePath}`);
        setFolderName("");
        setCreating(false);
        const refreshed = await listCompanionFolderOptions();
        setFolders(refreshed.folders);
        return;
      }
      if (status.status === "failed") {
        setMessage(status.error ?? "Windows could not create the folder.");
        setCreating(false);
        return;
      }
    }
    setMessage("Folder creation is still pending. Check the Windows companion.");
    setCreating(false);
  }

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
      <form action={() => void createFolder()} className="companionFolderForm">
        <h3>Create folder on Windows</h3>
        <label>
          Parent
          <select onChange={(event) => setParentFolder(event.target.value)} value={parentFolder}>
            <option value="">C:\Google Drive</option>
            {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
          </select>
        </label>
        <label>
          Folder name
          <input
            onChange={(event) => setFolderName(event.target.value)}
            required
            value={folderName}
          />
        </label>
        <label className="companionBranchChoice">
          <input
            checked={makeBranch}
            onChange={(event) => setMakeBranch(event.target.checked)}
            type="checkbox"
          />
          Make this folder a Branch
        </label>
        <button disabled={creating || !folderName.trim()} type="submit">
          {creating ? "Creating…" : "Create folder"}
        </button>
      </form>
      {message ? <p role="alert">{message}</p> : null}
    </section>
  );
}
