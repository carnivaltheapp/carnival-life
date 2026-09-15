"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  getCompanionFolderCreationStatus,
  requestCompanionBranchState,
  requestCompanionFolderCreation,
} from "../app/companion/actions";
import { loadTreeOfLifeFolders } from "../app/tree-of-life/actions";
import { folderTrailForPath, searchFolderTree, type FolderTreeNode } from "../domain/tree-of-life";
import { displayBranchPath } from "../lib/desktop/local-branches";

async function waitForCommand(commandId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    const status = await getCompanionFolderCreationStatus(commandId);
    if (status.status !== "pending") return status;
  }
  return { error: "Companion operation is still pending.", relativePath: null, status: "failed" as const };
}

export function AllFolderNavigator({
  onClose,
  onSelectBranch,
}: {
  onClose: () => void;
  onSelectBranch: (relativePath: string) => void;
}) {
  const [roots, setRoots] = useState<FolderTreeNode[]>([]);
  const [trail, setTrail] = useState<FolderTreeNode[]>([]);
  const [candidate, setCandidate] = useState<FolderTreeNode | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Loading folders…");
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [makeBranch, setMakeBranch] = useState(false);
  const [pending, setPending] = useState(false);
  const currentRelativePath = trail.at(-1)?.relativePath ?? "";
  const currentNodes = trail.at(-1)?.children ?? roots;
  const results = useMemo(() => searchFolderTree(roots, query), [query, roots]);

  async function refreshFolders(trailPaths = trail.map((node) => node.relativePath)) {
    const result = await loadTreeOfLifeFolders();
    setRoots(result.folders);
    setMessage(result.ok ? (result.folders.length ? "" : "No folders synchronized yet.") : result.message ?? "Folders unavailable.");
    const currentPath = trailPaths.at(-1) ?? "";
    if (!currentPath) {
      setTrail([]);
    } else {
      const nextTrail = folderTrailForPath(result.folders, currentPath);
      if (nextTrail) setTrail(nextTrail);
      else setMessage("The current parent folder could not be found.");
    }
    return result;
  }

  function selectCandidate(node: FolderTreeNode) {
    const nextTrail = folderTrailForPath(roots, node.relativePath);
    if (!nextTrail) {
      setMessage("The selected folder could not be found.");
      return;
    }
    setTrail(nextTrail);
    setCandidate(node);
    setQuery("");
  }

  useEffect(() => {
    let active = true;
    void loadTreeOfLifeFolders().then((result) => {
      if (!active) return;
      setRoots(result.folders);
      setMessage(result.ok
        ? (result.folders.length ? "" : "No folders synchronized yet.")
        : result.message ?? "Folders unavailable.");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  async function makeSelectedBranch() {
    if (!candidate) return;
    setPending(true);
    setMessage("");
    const request = await requestCompanionBranchState(candidate.relativePath, true);
    if (!request.commandId) {
      setMessage(request.unchanged ? "" : request.error ?? "Desktop companion unavailable");
      setPending(false);
      if (request.unchanged) {
        onSelectBranch(candidate.relativePath);
        onClose();
      }
      return;
    }
    const status = await waitForCommand(request.commandId);
    setPending(false);
    if (status.status !== "completed") {
      setMessage(status.error ?? "Desktop companion unavailable");
      return;
    }
    await refreshFolders();
    onSelectBranch(candidate.relativePath);
    onClose();
  }

  async function createFolder() {
    setPending(true);
    setMessage("");
    const request = await requestCompanionFolderCreation({
      isBranch: makeBranch,
      name: folderName,
      parentRelativePath: currentRelativePath,
    });
    if (!request.commandId) {
      setMessage(request.error ?? "Desktop companion unavailable");
      setPending(false);
      return;
    }
    const status = await waitForCommand(request.commandId);
    setPending(false);
    if (status.status !== "completed" || !status.relativePath) {
      setMessage(status.error ?? "Folder could not be created.");
      return;
    }
    await refreshFolders();
    setFolderName("");
    setNewFolder(false);
    if (makeBranch) {
      onSelectBranch(status.relativePath);
      onClose();
    } else {
      setMakeBranch(false);
      setMessage("Folder created.");
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal((
    <div className="allFolderOverlay" onPointerDown={onClose} role="presentation">
      <section
        aria-label="All folders"
        aria-modal="true"
        className="allFolderNavigator"
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <strong>Choose a folder</strong>
          <button aria-label="Close folder navigator" onClick={onClose} type="button">×</button>
        </header>
        <p className="allFolderBreadcrumb">
          C:\Google Drive{trail.length ? ` / ${trail.map((node) => node.name).join(" / ")}` : ""}
        </p>
        <input
          aria-label="Search Folders"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Folders"
          type="search"
          value={query}
        />
        <div className="allFolderList">
          {query.trim() ? results.map((node) => (
            <button className="allFolderSearchResult" key={node.relativePath} onClick={() => selectCandidate(node)} type="button">
              {node.isBranch ? <span aria-label="Branch">✓</span> : <span />}
              {displayBranchPath(node.relativePath)}
            </button>
          )) : (
            <>
              {trail.length ? <button className="allFolderBack" onClick={() => setTrail((value) => value.slice(0, -1))} type="button">‹ Back</button> : null}
              {currentNodes.map((node) => (
                <div className="allFolderRow" key={node.relativePath}>
                  <button onClick={() => selectCandidate(node)} type="button">
                    {node.isBranch ? <span aria-label="Branch">✓</span> : <span />}{node.name}
                  </button>
                  <button aria-label={`Open ${node.name}`} onClick={() => setTrail((value) => [...value, node])} type="button">›</button>
                </div>
              ))}
            </>
          )}
        </div>
        {candidate ? (
          <div className="allFolderCandidate">
            <span>{displayBranchPath(candidate.relativePath)}</span>
            <button
              disabled={pending}
              onClick={candidate.isBranch
                ? () => { onSelectBranch(candidate.relativePath); onClose(); }
                : () => void makeSelectedBranch()}
              type="button"
            >
              {candidate.isBranch ? "Select Branch" : "Make Branch"}
            </button>
          </div>
        ) : null}
        {newFolder ? (
          <div className="allFolderNewForm">
            <label>Folder name<input onChange={(event) => setFolderName(event.target.value)} value={folderName} /></label>
            <label><input checked={makeBranch} onChange={(event) => setMakeBranch(event.target.checked)} type="checkbox" /> Make this a Branch</label>
            <div><button onClick={() => setNewFolder(false)} type="button">Cancel</button><button disabled={pending || !folderName} onClick={() => void createFolder()} type="button">Create Folder</button></div>
          </div>
        ) : <button className="allFolderNewButton" onClick={() => { setCandidate(null); setNewFolder(true); }} type="button">+ New Folder</button>}
        {message ? <p className="allFolderMessage" role="status">{message}</p> : null}
      </section>
    </div>
  ), document.body);
}
