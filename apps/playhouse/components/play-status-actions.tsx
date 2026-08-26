"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { doneCreate, markPlayDone, trashPlay } from "../app/plays/actions";
import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
  PlayPlacement,
} from "../domain/play";
import { INITIAL_PLAY_MUTATION_STATE } from "../domain/play-mutation";

export function PlayStatusActions({
  baskets,
  defaultPlacement,
  nextPlay,
  play,
}: {
  baskets: BasketSummary[];
  defaultPlacement: PlayPlacement;
  nextPlay?: NextPlayOption;
  play: PlayListItem;
}) {
  const router = useRouter();
  const [placementKind, setPlacementKind] = useState(defaultPlacement.kind);
  const [doneState, doneAction, donePending] = useActionState(
    markPlayDone,
    INITIAL_PLAY_MUTATION_STATE,
  );
  const [trashState, trashAction, trashPending] = useActionState(
    trashPlay,
    INITIAL_PLAY_MUTATION_STATE,
  );
  const [workflowState, workflowAction, workflowPending] = useActionState(
    doneCreate,
    INITIAL_PLAY_MUTATION_STATE,
  );
  const anyPending = donePending || trashPending || workflowPending;
  const errorMessage =
    doneState.status === "error"
      ? doneState.message
      : trashState.status === "error"
        ? trashState.message
        : workflowState.status === "error"
          ? workflowState.message
          : null;

  useEffect(() => {
    if (workflowState.status === "success" && workflowState.redirectTo) {
      router.push(workflowState.redirectTo);
    }
  }, [router, workflowState.redirectTo, workflowState.status]);

  return (
    <div className="statusActionArea">
      <div className="statusActions">
        <form action={doneAction}>
          <input name="playId" type="hidden" value={play.id} />
          <button className="doneButton" disabled={anyPending} type="submit">
            {donePending ? "Finishing…" : "Done"}
          </button>
        </form>

        {nextPlay ? (
          <form action={workflowAction}>
            <input name="playId" type="hidden" value={play.id} />
            <input name="doneCreateMode" type="hidden" value="existing" />
            <button
              className="workflowButton"
              disabled={anyPending}
              title={`Complete this Play and continue to ${nextPlay.title}`}
              type="submit"
            >
              {workflowPending ? "Continuing…" : "Done / Continue"}
            </button>
          </form>
        ) : (
          <details className="doneCreateDisclosure">
            <summary>Done / Create next</summary>
            <form action={workflowAction} className="doneCreateForm" noValidate>
              <input name="playId" type="hidden" value={play.id} />
              <input name="doneCreateMode" type="hidden" value="new" />
              <p>
                Complete <strong>{play.title}</strong> and create the next step.
              </p>

              <label className="field field--wide">
                <span>Next Play title</span>
                <input
                  aria-invalid={Boolean(workflowState.fieldErrors?.title)}
                  maxLength={500}
                  name="nextTitle"
                  required
                />
                {workflowState.fieldErrors?.title ? (
                  <small className="fieldError">{workflowState.fieldErrors.title}</small>
                ) : null}
              </label>

              <label className="field">
                <span>Type</span>
                <select defaultValue="normal" name="nextPlayType">
                  <option value="normal">Normal</option>
                  <option value="reminder">Reminder</option>
                </select>
              </label>

              <label className="field">
                <span>Placement</span>
                <select
                  name="nextPlacementKind"
                  onChange={(event) =>
                    setPlacementKind(event.target.value as "calendar" | "basket")
                  }
                  value={placementKind}
                >
                  <option value="calendar">Calendar date</option>
                  <option value="basket">Basket</option>
                </select>
              </label>

              {placementKind === "calendar" ? (
                <label className="field field--wide">
                  <span>Date</span>
                  <input
                    defaultValue={
                      defaultPlacement.kind === "calendar"
                        ? defaultPlacement.scheduledDate
                        : ""
                    }
                    name="nextScheduledDate"
                    required
                    type="date"
                  />
                  {workflowState.fieldErrors?.scheduledDate ? (
                    <small className="fieldError">
                      {workflowState.fieldErrors.scheduledDate}
                    </small>
                  ) : null}
                </label>
              ) : (
                <label className="field field--wide">
                  <span>Basket</span>
                  <select
                    defaultValue={
                      defaultPlacement.kind === "basket"
                        ? defaultPlacement.basketId
                        : baskets[0]?.id
                    }
                    name="nextBasketId"
                    required
                  >
                    {baskets.map((basket) => (
                      <option key={basket.id} value={basket.id}>
                        {basket.name}
                      </option>
                    ))}
                  </select>
                  {workflowState.fieldErrors?.basketId ? (
                    <small className="fieldError">
                      {workflowState.fieldErrors.basketId}
                    </small>
                  ) : null}
                </label>
              )}

              <button className="primaryButton field--wide" disabled={anyPending} type="submit">
                {workflowPending ? "Creating…" : "Complete and create next"}
              </button>
            </form>
          </details>
        )}

        <form action={trashAction}>
          <input name="playId" type="hidden" value={play.id} />
          <button className="trashButton" disabled={anyPending} type="submit">
            {trashPending ? "Moving…" : "Trash"}
          </button>
        </form>
      </div>
      {nextPlay ? <small className="nextPlayHint">Next: {nextPlay.title}</small> : null}
      {errorMessage ? <p className="rowError" role="alert">{errorMessage}</p> : null}
    </div>
  );
}
