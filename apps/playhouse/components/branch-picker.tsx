"use client";

import { useEffect, useRef, useState } from "react";

import {
  canonicalBranchValue,
  conciseBranchName,
  loadLocalBranches,
  type LocalBranchNode,
} from "../lib/desktop/local-branches";

export function BranchPicker({ initialBranch }: { initialBranch: string }) {
  const [selectedBranch, setSelectedBranch] = useState(initialBranch);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [roots, setRoots] = useState<LocalBranchNode[]>([]);
  const [trail, setTrail] = useState<LocalBranchNode[]>([]);
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
    const result = await loadLocalBranches();
    setRoots(result.branches);
    setStatus(result.ok ? "ready" : "unavailable");
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
        <span>{selectedBranch ? conciseBranchName(selectedBranch) : "Branch"}</span>
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
          {status === "ready" ? currentNodes.map((node) => (
            <div className="branchPickerRow" key={node.path}>
              <button
                className="branchPickerName"
                disabled={!node.selectable}
                onClick={() => {
                  setSelectedBranch(canonicalBranchValue(node.path));
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
