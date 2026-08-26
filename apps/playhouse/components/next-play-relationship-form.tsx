"use client";

import { useActionState } from "react";

import { setNextPlay } from "../app/plays/actions";
import type { NextPlayOption } from "../domain/play";
import { INITIAL_PLAY_MUTATION_STATE } from "../domain/play-mutation";

export function NextPlayRelationshipForm({
  currentNextPlayId,
  options,
  playId,
}: {
  currentNextPlayId: string | null;
  options: NextPlayOption[];
  playId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    setNextPlay,
    INITIAL_PLAY_MUTATION_STATE,
  );

  return (
    <form action={formAction} className="relationshipForm">
      <input name="fromPlayId" type="hidden" value={playId} />
      <label className="field">
        <span>Next Play</span>
        <select defaultValue={currentNextPlayId ?? ""} name="nextPlayId">
          <option value="">No next Play</option>
          {options
            .filter((option) => option.id !== playId)
            .map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}{option.status === "open" ? "" : ` (${option.status})`}
              </option>
            ))}
        </select>
      </label>
      <button className="secondaryButton" disabled={isPending} type="submit">
        {isPending ? "Saving…" : "Save next Play"}
      </button>
      {state.message ? (
        <p
          className={state.status === "error" ? "formError" : "formSuccess"}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
