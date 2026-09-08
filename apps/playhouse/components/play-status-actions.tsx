"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { doneCreate, markPlayDone, trashPlay } from "../app/plays/actions";
import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
  PlayPlacement,
} from "../domain/play";
import { INITIAL_PLAY_MUTATION_STATE } from "../domain/play-mutation";
import { gmailThreadUrl, usablePlayUrl } from "../domain/play-display";

export function DoneIcon() {
  return <span aria-hidden="true">✓</span>;
}

export function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M6.5 6.5v8m3.5-8v8m3.5-8v8M4.5 4.5h11m-7-2h3m-6 2 .7 12h7.6l.7-12" />
    </svg>
  );
}

export function GmailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M3 5.5 10 11l7-5.5M3 5.5v9h14v-9" />
    </svg>
  );
}

export function BrowserIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="2.4" />
      <path d="M10 3h6M4 6.2l3 5.2m1.7 5.5 3-5.2" />
    </svg>
  );
}

export function PlayInfo({ play }: { play: PlayListItem }) {
  const infoDialogRef = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const playJson = JSON.stringify(play, null, 2);

  async function copyPlayJson() {
    try {
      await navigator.clipboard.writeText(playJson);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  return (
    <>
      <button
        aria-label="Play information"
        className="rowIconButton infoButton editPlayInfo"
        onClick={() => infoDialogRef.current?.showModal()}
        title="View Play JSON"
        type="button"
      >
        <span aria-hidden="true" className="infoGlyph">i</span>
      </button>
      <dialog className="playInfoDialog" ref={infoDialogRef}>
        <div className="playInfoHeader">
          <strong>Play JSON</strong>
          <div className="playInfoHeaderActions">
            <button className="playInfoTextButton" onClick={copyPlayJson} type="button">
              {copyStatus === "copied"
                ? "Copied"
                : copyStatus === "error"
                  ? "Copy failed"
                  : "Copy"}
            </button>
            <button
              aria-label="Close Play information"
              className="playInfoTextButton"
              onClick={() => {
                infoDialogRef.current?.close();
                setCopyStatus("idle");
              }}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
        <pre>{playJson}</pre>
      </dialog>
    </>
  );
}

export function PlayStatusActions({ play }: { play: PlayListItem }) {
  const [doneState, doneAction, donePending] = useActionState(
    markPlayDone,
    INITIAL_PLAY_MUTATION_STATE,
  );
  const [trashState, trashAction, trashPending] = useActionState(
    trashPlay,
    INITIAL_PLAY_MUTATION_STATE,
  );
  const anyPending = donePending || trashPending;
  const errorMessage =
    doneState.status === "error"
      ? doneState.message
      : trashState.status === "error"
        ? trashState.message
        : null;
  const playUrl = usablePlayUrl(play.url);

  return (
    <div className="statusActionArea">
      <div className="statusActions">
        <form action={doneAction}>
          <input name="playId" type="hidden" value={play.id} />
          <button
            aria-label="Done"
            className="rowIconButton doneButton"
            disabled={anyPending}
            title="Mark Done"
            type="submit"
          >
            {donePending ? <span aria-hidden="true">…</span> : <DoneIcon />}
          </button>
        </form>
        <form action={trashAction}>
          <input name="playId" type="hidden" value={play.id} />
          <button
            aria-label="Trash"
            className="rowIconButton trashButton"
            disabled={anyPending}
            title="Move to Trash"
            type="submit"
          >
            {trashPending ? <span aria-hidden="true">…</span> : <TrashIcon />}
          </button>
        </form>
        {play.gmailThreadId ? (
          <a
            aria-label="Open Gmail thread"
            className="rowIconButton gmailButton"
            href={gmailThreadUrl(play.gmailThreadId)}
            rel="noopener noreferrer"
            target="_blank"
            title="Open Gmail thread"
          >
            <GmailIcon />
          </a>
        ) : (
          <span aria-hidden="true" className="rowActionPlaceholder" />
        )}
        {playUrl ? (
          <a
            aria-label="Open Play URL"
            className="rowIconButton urlButton"
            href={playUrl}
            rel="noopener noreferrer"
            target="_blank"
            title="Open Play URL"
          >
            <BrowserIcon />
          </a>
        ) : (
          <span aria-hidden="true" className="rowActionPlaceholder" />
        )}
      </div>
      {errorMessage ? (
        <p className="rowError" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export function PlayWorkflowActions({
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
  const [workflowState, workflowAction, workflowPending] = useActionState(
    doneCreate,
    INITIAL_PLAY_MUTATION_STATE,
  );

  useEffect(() => {
    if (workflowState.status === "success" && workflowState.redirectTo) {
      router.push(workflowState.redirectTo);
    }
  }, [router, workflowState.redirectTo, workflowState.status]);

  return (
    <div className="workflowActions">
      {nextPlay ? (
        <form action={workflowAction}>
          <input name="playId" type="hidden" value={play.id} />
          <input name="doneCreateMode" type="hidden" value="existing" />
          <button
            className="workflowButton"
            disabled={workflowPending}
            title={`Complete this Play and continue to ${nextPlay.title}`}
            type="submit"
          >
            {workflowPending ? "Continuing…" : "Done / Continue"}
          </button>
          <small className="nextPlayHint">Next: {nextPlay.title}</small>
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
              <span className="srOnly">Next Play title</span>
              <input
                aria-invalid={Boolean(workflowState.fieldErrors?.title)}
                maxLength={500}
                name="nextTitle"
                placeholder="Next Play title"
                required
              />
              {workflowState.fieldErrors?.title ? (
                <small className="fieldError">
                  {workflowState.fieldErrors.title}
                </small>
              ) : null}
            </label>

            <label className="field">
              <span className="srOnly">Type</span>
              <select aria-label="Type" defaultValue="normal" name="nextPlayType">
                <option value="normal">Type: Normal</option>
                <option value="reminder">Type: Reminder</option>
              </select>
            </label>

            <label className="field">
              <span className="srOnly">Placement</span>
              <select
                aria-label="Placement"
                name="nextPlacementKind"
                onChange={(event) =>
                  setPlacementKind(event.target.value as "calendar" | "basket")
                }
                value={placementKind}
              >
                <option value="calendar">Placement: Calendar date</option>
                <option value="basket">Placement: Basket</option>
              </select>
            </label>

            {placementKind === "calendar" ? (
              <label className="field field--wide">
                <span className="srOnly">Date</span>
                <input
                  aria-label="Date"
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
                <span className="srOnly">Basket</span>
                <select
                  aria-label="Basket"
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

            <button
              className="primaryButton field--wide"
              disabled={workflowPending}
              type="submit"
            >
              {workflowPending ? "Creating…" : "Complete and create next"}
            </button>
          </form>
        </details>
      )}
      {workflowState.status === "error" ? (
        <p className="rowError" role="alert">
          {workflowState.message}
        </p>
      ) : null}
    </div>
  );
}
