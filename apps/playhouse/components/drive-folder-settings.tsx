"use client";

import { useActionState } from "react";

import { backfillTreeOfLifeDriveFolders } from "../app/tree-of-life/actions";
import type { CalendarSettingsAccount } from "../domain/calendar-settings";
import { INITIAL_DRIVE_BACKFILL_STATE } from "../domain/drive-backfill";

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
        <label>
          <span>Google account</span>
          <select name="googleAccountId" required>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.email ?? account.displayName ?? "Google account"}
              </option>
            ))}
          </select>
        </label>
        <button disabled={pending || accounts.length === 0} type="submit">
          {pending ? "Resolving…" : "Resolve Drive Folders"}
        </button>
      </form>
      {state.message ? <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
      {state.summary ? (
        <dl className="driveFolderSummary">
          <div><dt>Branches processed</dt><dd>{state.summary.processed}</dd></div>
          <div><dt>Branches resolved</dt><dd>{state.summary.resolved}</dd></div>
          <div><dt>Already resolved</dt><dd>{state.summary.alreadyResolved}</dd></div>
          <div><dt>Not found</dt><dd>{state.summary.notFound}</dd></div>
          <div><dt>Ambiguous</dt><dd>{state.summary.ambiguous}</dd></div>
          <div><dt>Authorization required</dt><dd>{state.summary.authRequired}</dd></div>
          <div><dt>Errors</dt><dd>{state.summary.errors}</dd></div>
          <div><dt>Duration</dt><dd>{state.summary.durationMs} ms</dd></div>
        </dl>
      ) : null}
      {state.summary?.unresolved.length ? (
        <div className="driveFolderUnresolved">
          <strong>Unresolved sample</strong>
          <ul>
            {state.summary.unresolved.map((item) => (
              <li key={`${item.status}:${item.relativePath}`}>{item.relativePath} — {item.status}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
