"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  DEFAULT_GRID_FONT_SIZE,
  GRID_FONT_SIZE_STORAGE_KEY,
  MAX_GRID_FONT_SIZE,
  MIN_GRID_FONT_SIZE,
  parseGridFontSize,
  stepGridFontSize,
} from "../domain/grid-font-size";

const GRID_FONT_SIZE_EVENT = "playhouse-grid-font-size-change";

function subscribeToGridFontSize(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(GRID_FONT_SIZE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(GRID_FONT_SIZE_EVENT, onStoreChange);
  };
}

function storedGridFontSize() {
  try {
    return parseGridFontSize(window.localStorage.getItem(GRID_FONT_SIZE_STORAGE_KEY));
  } catch {
    return DEFAULT_GRID_FONT_SIZE;
  }
}

function persistGridFontSize(fontSize: number) {
  try {
    window.localStorage.setItem(GRID_FONT_SIZE_STORAGE_KEY, String(fontSize));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(GRID_FONT_SIZE_EVENT));
}

export function useGridFontSizePreference() {
  return useSyncExternalStore(
    subscribeToGridFontSize,
    storedGridFontSize,
    () => DEFAULT_GRID_FONT_SIZE,
  );
}

function GearIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9.7 3.4h4.6l.5 2.1 1.5.9 2.1-.7 2.3 4-1.6 1.4v1.8l1.6 1.4-2.3 4-2.1-.7-1.5.9-.5 2.1H9.7l-.5-2.1-1.5-.9-2.1.7-2.3-4 1.6-1.4v-1.8L3.3 9.7l2.3-4 2.1.7 1.5-.9.5-2.1Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function GridSettings({ fontSize }: { fontSize: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="gridSettings" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-label="Settings"
        className="settingsButton"
        onClick={() => setOpen((current) => !current)}
        title="Settings"
        type="button"
      >
        <GearIcon />
      </button>
      {open ? (
        <div aria-label="Settings menu" className="settingsPopover" role="dialog">
          <span>Font Size</span>
          <output aria-label="Current grid font size">{fontSize}px</output>
          <button
            aria-label="Decrease font size"
            disabled={fontSize <= MIN_GRID_FONT_SIZE}
            onClick={() => persistGridFontSize(stepGridFontSize(fontSize, -1))}
            type="button"
          >
            ↓
          </button>
          <button
            aria-label="Increase font size"
            disabled={fontSize >= MAX_GRID_FONT_SIZE}
            onClick={() => persistGridFontSize(stepGridFontSize(fontSize, 1))}
            type="button"
          >
            ↑
          </button>
        </div>
      ) : null}
    </div>
  );
}
