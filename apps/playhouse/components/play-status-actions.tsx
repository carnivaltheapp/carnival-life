"use client";

import { useActionState } from "react";

import {
  markPlayDone,
  trashPlay,
} from "../app/plays/actions";
import { INITIAL_PLAY_MUTATION_STATE } from "../domain/play-mutation";

export function PlayStatusActions({ playId }: { playId: string }) {
  const [doneState, doneAction, donePending] = useActionState(
    markPlayDone,
    INITIAL_PLAY_MUTATION_STATE,
  );
  const [trashState, trashAction, trashPending] = useActionState(
    trashPlay,
    INITIAL_PLAY_MUTATION_STATE,
  );
  const errorMessage =
    doneState.status === "error"
      ? doneState.message
      : trashState.status === "error"
        ? trashState.message
        : null;

  return (
    <div className="statusActionArea">
      <div className="statusActions">
        <form action={doneAction}>
          <input name="playId" type="hidden" value={playId} />
          <button className="doneButton" disabled={donePending || trashPending} type="submit">
            {donePending ? "Finishing…" : "Done"}
          </button>
        </form>
        <form action={trashAction}>
          <input name="playId" type="hidden" value={playId} />
          <button className="trashButton" disabled={donePending || trashPending} type="submit">
            {trashPending ? "Moving…" : "Trash"}
          </button>
        </form>
      </div>
      {errorMessage ? <p className="rowError" role="alert">{errorMessage}</p> : null}
    </div>
  );
}
