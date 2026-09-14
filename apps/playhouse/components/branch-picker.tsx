"use client";

import { useEffect, useRef, useState } from "react";

import { bootstrapTreeOfLife, loadTreeOfLifeBranches } from "../app/tree-of-life/actions";
import type { BranchTreeNode } from "../domain/tree-of-life";
import {
  canonicalBranchValue,
  displayBranchPath,
  loadLocalBranches,
} from "../lib/desktop/local-branches";

export function BranchPicker({ initialBranch }: { initialBranch: string }) {
  const [selectedBranch, setSelectedBranch] = useState(initialBranch);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty" | "unavailable">("idle");
  const [message, setMessage] = useState("");
  const [roots, setRoots] = useState<BranchTreeNode[]>([]);
  const [trail, setTrail] = useState<BranchTreeNode[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);
  const currentNodes = trail.at(-1)?.children ?? roots;

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function togglePicker() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || status !== "idle") return;
    setStatus("loading");
    const result = await loadTreeOfLifeBranches();
    setRoots(result.branches);
    setStatus(result.ok ? (result.initialized ? "ready" : "empty") : "unavailable");
  }

  async function importTreeOfLife() {
    setStatus("loading");
    setMessage("");
    const local = await loadLocalBranches();
    if (!local.ok) {
      setStatus("empty");
      setMessage("Desktop Branch scan unavailable.");
      return;
    }
    const result = await bootstrapTreeOfLife(local.branches);
    setRoots(result.branches);
    setStatus(result.ok && result.initialized ? "ready" : "empty");
    setMessage(result.message ?? "");
  }

  return (
    <div className="branchPicker" ref={pickerRef}>
      <input name="branch" readOnly type="hidden" value={selectedBranch} />
      <button
        aria-expanded={open}
        aria-label="Branch"
        className="branchPickerTrigger"
        onClick={togglePicker}
        type="button"
      >
        <span>{selectedBranch ? displayBranchPath(selectedBranch) : "Branch"}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div aria-label="Branch hierarchy" className="branchPickerMenu" role="dialog">
          {trail.length ? (
            <button
              className="branchPickerBack"
              onClick={() => setTrail((current) => current.slice(0, -1))}
              type="button"
            >
              ‹ {trail.map((node) => node.name).join(" / ")}
            </button>
          ) : null}
          {status === "loading" ? <p>Loading Branches…</p> : null}
          {status === "unavailable" ? <p>Branches unavailable</p> : null}
          {status === "empty" ? (
            <div>
              <p>{message || "Tree of Life has not been imported."}</p>
              <button className="branchPickerImport" onClick={importTreeOfLife} type="button">
                Import Tree of Life
              </button>
            </div>
          ) : null}
          {status === "ready" ? currentNodes.map((node) => (
            <div className="branchPickerRow" key={node.relativePath}>
              <button
                className="branchPickerName"
                disabled={!node.selectable}
                onClick={() => {
                  setSelectedBranch(canonicalBranchValue(node.relativePath));
                  setOpen(false);
                  setTrail([]);
                }}
                type="button"
              >
                {node.name}
              </button>
              {node.children.length ? (
                <button
                  aria-label={`Open ${node.name}`}
                  className="branchPickerDrill"
                  onClick={() => setTrail((current) => [...current, node])}
                  type="button"
                >
                  ›
                </button>
              ) : <span />}
            </div>
          )) : null}
        </div>
      ) : null}
    </div>
  );
}
