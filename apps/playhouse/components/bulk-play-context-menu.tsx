"use client";

import { useEffect, useRef, useState } from "react";

import type { BasketSummary } from "../domain/play";
import type { BulkPlayChange } from "../domain/play-bulk-change";

export function BulkPlayContextMenu({
  baskets,
  onApply,
  onClose,
  reminderDate,
  todayDate,
  x,
  y,
}: {
  baskets: BasketSummary[];
  onApply: (change: BulkPlayChange) => void;
  onClose: () => void;
  reminderDate: string;
  todayDate: string;
  x: number;
  y: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const [dateFallbackOpen, setDateFallbackOpen] = useState(false);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) onClose();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  function openDatePicker() {
    const picker = dateRef.current;
    if (!picker) return;
    try {
      if (typeof picker.showPicker === "function") {
        picker.showPicker();
        return;
      }
    } catch {
      // Use the visible native-input fallback below.
    }
    setDateFallbackOpen(true);
    picker.focus();
  }

  return (
    <div
      aria-label="Bulk Play actions"
      className="bulkContextMenu"
      onContextMenu={(event) => event.preventDefault()}
      ref={menuRef}
      role="menu"
      style={{ left: x, top: y }}
    >
      <details>
        <summary role="menuitem">Move <span aria-hidden="true">›</span></summary>
        <div className="bulkContextSubmenu">
          <button onClick={openDatePicker} role="menuitem" type="button">Calendar</button>
          <input
            aria-label="Move selected Plays to date"
            className="bulkDateInput"
            data-open={dateFallbackOpen || undefined}
            min={todayDate}
            onChange={(event) => {
              if (event.target.value >= todayDate) {
                onApply({
                  kind: "move",
                  placement: { kind: "calendar", scheduledDate: event.target.value },
                });
              }
            }}
            ref={dateRef}
            tabIndex={dateFallbackOpen ? 0 : -1}
            type="date"
          />
          <details>
            <summary role="menuitem">Basket <span aria-hidden="true">›</span></summary>
            <div className="bulkContextSubmenu nested">
              {baskets.map((basket) => (
                <button
                  key={basket.id}
                  onClick={() => onApply({
                    kind: "move",
                    placement: { basketId: basket.id, kind: "basket" },
                  })}
                  role="menuitem"
                  type="button"
                >
                  {basket.name}
                </button>
              ))}
            </div>
          </details>
        </div>
      </details>
      <details>
        <summary role="menuitem">Change <span aria-hidden="true">›</span></summary>
        <div className="bulkContextSubmenu">
          <details>
            <summary role="menuitem">Rank <span aria-hidden="true">›</span></summary>
            <div className="bulkContextSubmenu nested">
              <button onClick={() => onApply({
                kind: "rank",
                playType: "normal",
                reminderDate,
              })} role="menuitem" type="button">Headline</button>
              <button onClick={() => onApply({
                kind: "rank",
                playType: "reminder",
                reminderDate,
              })} role="menuitem" type="button">Reminder</button>
            </div>
          </details>
          <details>
            <summary role="menuitem">Push <span aria-hidden="true">›</span></summary>
            <div className="bulkContextSubmenu nested">
              {([
                ["Everyday", "everyday"],
                ["Weekday", "weekdays"],
                ["Weekend", "weekends"],
              ] as const).map(([label, pushRule]) => (
                <button key={pushRule} onClick={() => onApply({
                  kind: "push",
                  pushRule,
                })} role="menuitem" type="button">{label}</button>
              ))}
            </div>
          </details>
          <details>
            <summary role="menuitem">Duration <span aria-hidden="true">›</span></summary>
            <div className="bulkContextSubmenu nested">
              {[15, 30, 45, 60, 90, 120].map((durationMinutes) => (
                <button key={durationMinutes} onClick={() => onApply({
                  durationMinutes,
                  kind: "duration",
                })} role="menuitem" type="button">{durationMinutes}</button>
              ))}
            </div>
          </details>
        </div>
      </details>
    </div>
  );
}
