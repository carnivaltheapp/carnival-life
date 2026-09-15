"use client";

import { useActionState } from "react";

import {
  backfillTreeOfLifeDriveFolders,
  INITIAL_DRIVE_BACKFILL_STATE,
} from "../app/tree-of-life/actions";
import type { CalendarSettingsAccount } from "../domain/calendar-settings";

export function DriveFolderSettings({ accounts }: { accounts: CalendarSettingsAccount[] }) {
  const [state, action, pending] = useActionState(
    backfillTreeOfLifeDriveFolders,
    INITIAL_DRIVE_BACKFILL_STATE,
  );
  return (
    <section aria-labelledby="drive-folder-settings-heading" className="driveFolderSettings">
      <h2 id="drive-folder-settings-heading">Drive Folders</h2>
      <p>Resolve exact Google Drive folder IDs for existing Tree of Life Branches.</p>
      <form action={action}>
        <select aria-label="Google account" name="googleAccountId" required>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.email ?? account.displayName ?? "Google account"}
            </option>
          ))}
        </select>
        <button disabled={pending || accounts.length === 0} type="submit">
          {pending ? "Resolving…" : "Resolve Drive Folders"}
        </button>
      </form>
      {state.message ? <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </section>
  );
}
