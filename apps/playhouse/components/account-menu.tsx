"use client";

import { useEffect, useRef, useState } from "react";

import { signOut } from "../app/auth/actions";
import type { CalendarSettingsAccount } from "../domain/calendar-settings";
import { GridSettings } from "./grid-settings";

export function AccountMenu({
  calendarAccounts,
  calendarSettingsError,
  displayName,
  email,
  fontSize,
}: {
  calendarAccounts: CalendarSettingsAccount[];
  calendarSettingsError: boolean;
  displayName: string;
  email: string | null;
  fontSize: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
        setProfileOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setProfileOpen(false);
      }
    }
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="accountMenu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-label="User menu"
        className="accountAvatar"
        onClick={() => setOpen((current) => !current)}
        title="User menu"
        type="button"
      >
        {displayName.slice(0, 1).toUpperCase()}
      </button>
      {open ? (
        <div aria-label="User menu" className="accountMenuPopover" role="dialog">
          <button
            aria-expanded={profileOpen}
            className="accountMenuItem"
            onClick={() => setProfileOpen((current) => !current)}
            type="button"
          >
            Profile
          </button>
          {profileOpen ? (
            <section aria-label="Profile" className="profileSummary">
              <strong>{displayName}</strong>
              {email ? <span>{email}</span> : null}
            </section>
          ) : null}
          <GridSettings
            calendarAccounts={calendarAccounts}
            calendarSettingsError={calendarSettingsError}
            fontSize={fontSize}
            trigger="menu"
          />
          <form action={signOut} className="accountSignOutForm">
            <button className="accountMenuItem accountSignOut" type="submit">
              Sign Out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
