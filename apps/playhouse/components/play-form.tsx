"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { savePlay } from "../app/plays/actions";
import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
  PlayPlacement,
  PlayType,
} from "../domain/play";
import type { PlayInputField } from "../domain/play-input";
import { INITIAL_PLAY_MUTATION_STATE } from "../domain/play-mutation";
import { NextPlayRelationshipForm } from "./next-play-relationship-form";
import { applySuccessfulPlaySave } from "./play-form-success";
import { PlayerCombobox } from "./player-combobox";
import { PlayWorkflowActions } from "./play-status-actions";

const PLACE_OPTIONS = ["office", "outside", "any"] as const;

function FieldError({ field, errors }: {
  field: PlayInputField;
  errors: Partial<Record<PlayInputField, string>> | undefined;
}) {
  const message = errors?.[field];
  return message ? <small className="fieldError">{message}</small> : null;
}

export function PlayForm({
  baskets,
  defaultPlacement,
  nextPlayOptions,
  play,
  supportsWorkflows,
}: {
  baskets: BasketSummary[];
  defaultPlacement: PlayPlacement;
  nextPlayOptions: NextPlayOption[];
  play?: PlayListItem;
  supportsWorkflows: boolean;
}) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const initialPlacement: PlayPlacement = play
    ? play.basketId
      ? { basketId: play.basketId, kind: "basket" }
      : { kind: "calendar", scheduledDate: play.scheduledDate ?? "" }
    : defaultPlacement;
  const [placementKind, setPlacementKind] = useState(initialPlacement.kind);
  const [playType, setPlayType] = useState<PlayType>(play?.playType ?? "normal");
  const [state, formAction, isPending] = useActionState(
    savePlay,
    INITIAL_PLAY_MUTATION_STATE,
  );
  const isEditing = Boolean(play);
  const hasNonstandardPlace = Boolean(
    play?.place && !PLACE_OPTIONS.some((place) => place === play.place),
  );
  const submittedValues = state.values;
  const submittedPlayerId = submittedValues?.playerContactId ?? null;
  const submittedPlayerName = submittedValues?.playerDisplayName ?? null;
  const initialPlayer = submittedValues
    ? submittedPlayerId && submittedPlayerName
      ? { displayName: submittedPlayerName, id: submittedPlayerId }
      : null
    : play?.playerContactId
      ? {
          displayName: play.playerDisplayName ?? "Selected Player",
          id: play.playerContactId,
        }
      : null;

  useEffect(() => {
    applySuccessfulPlaySave(state.status, {
      close: () => detailsRef.current?.removeAttribute("open"),
      refresh: () => router.refresh(),
    });
  }, [router, state]);

  return (
    <details
      className={isEditing ? "editDisclosure" : "createDisclosure"}
      data-testid={isEditing ? "edit-play" : "create-play"}
      ref={detailsRef}
    >
      <summary
        className={isEditing ? "playTitleLink" : undefined}
        data-testid={isEditing ? "play-title" : undefined}
      >
        {isEditing ? play?.title : "+ New Play"}
      </summary>
      <form action={formAction} className="playForm" noValidate>
        {play ? <input name="playId" type="hidden" value={play.id} /> : null}

        <label className="field compactField field--wide">
          <span className="srOnly">Title</span>
          <input
            aria-invalid={Boolean(state.fieldErrors?.title)}
            defaultValue={submittedValues?.title ?? play?.title}
            maxLength={500}
            name="title"
            placeholder="Title"
            required
          />
          <FieldError errors={state.fieldErrors} field="title" />
        </label>

        <div className="formRow field--wide">
          <label className="field compactField">
            <span className="srOnly">Type</span>
            <select
              aria-label="Type"
              name="playType"
              onChange={(event) => setPlayType(event.target.value as PlayType)}
              value={playType}
            >
              <option value="normal">Type: Normal</option>
              <option value="reminder">Type: Reminder</option>
            </select>
            <FieldError errors={state.fieldErrors} field="playType" />
          </label>
          <label className="field compactField">
            <span className="srOnly">Placement</span>
            <select
              aria-label="Placement"
              name="placementKind"
              onChange={(event) =>
                setPlacementKind(event.target.value as "calendar" | "basket")
              }
              value={placementKind}
            >
              <option value="calendar">Placement: Calendar date</option>
              <option value="basket">Placement: Basket</option>
            </select>
            <FieldError errors={state.fieldErrors} field="placement" />
          </label>
        </div>

        <PlayerCombobox
          error={state.fieldErrors?.playerContactId}
          initialSelection={initialPlayer}
          key={`${submittedPlayerId ?? play?.playerContactId ?? "none"}:${submittedPlayerName ?? play?.playerDisplayName ?? ""}`}
        />

        <div className="formRow dateUrlRow field--wide">
          {placementKind === "calendar" ? (
            <label className="field compactField">
              <span className="srOnly">Date</span>
              <input
                aria-label="Date"
                aria-invalid={Boolean(state.fieldErrors?.scheduledDate)}
                defaultValue={
                  submittedValues?.scheduledDate ??
                  (initialPlacement.kind === "calendar" ? initialPlacement.scheduledDate : "")
                }
                name="scheduledDate"
                required
                type="date"
              />
              <FieldError errors={state.fieldErrors} field="scheduledDate" />
            </label>
          ) : (
            <label className="field compactField">
              <span className="srOnly">Basket</span>
              <select
                aria-label="Basket"
                aria-invalid={Boolean(state.fieldErrors?.basketId)}
                defaultValue={
                  submittedValues?.basketId ??
                  (initialPlacement.kind === "basket"
                    ? initialPlacement.basketId
                    : baskets[0]?.id)
                }
                name="basketId"
                required
              >
                {baskets.map((basket) => (
                  <option key={basket.id} value={basket.id}>
                    {basket.name}
                  </option>
                ))}
              </select>
              <FieldError errors={state.fieldErrors} field="basketId" />
            </label>
          )}
          <label className="field compactField">
            <span className="srOnly">URL</span>
            <input
              aria-label="URL"
              defaultValue={submittedValues?.url ?? play?.url ?? ""}
              maxLength={2048}
              name="url"
              placeholder="URL"
              type="url"
            />
            <FieldError errors={state.fieldErrors} field="url" />
          </label>
        </div>

        <div className="formRow field--wide">
          <label className="field compactField">
            <span className="srOnly">Branch</span>
            <input
              aria-label="Branch"
              defaultValue={submittedValues?.branch ?? play?.branch ?? ""}
              maxLength={200}
              name="branch"
              placeholder="Branch"
            />
            <FieldError errors={state.fieldErrors} field="branch" />
          </label>
          <label className="field compactField">
            <span className="srOnly">Place</span>
            <select
              aria-label="Place"
              defaultValue={
                submittedValues?.place ?? (play ? (play.place ?? "") : "office")
              }
              key={submittedValues?.place ?? "initial"}
              name="place"
            >
              <option value="">Place: Unspecified</option>
              {hasNonstandardPlace ? (
                <option value={play?.place ?? ""}>{play?.place}</option>
              ) : null}
              <option value="office">Place: Office</option>
              <option value="outside">Place: Outside</option>
              <option value="any">Place: Any</option>
            </select>
            <FieldError errors={state.fieldErrors} field="place" />
          </label>
        </div>

        <div className="formRow field--wide">
          <label className="field compactField">
            <span className="srOnly">Duration (minutes)</span>
            <input
              aria-label="Duration (minutes)"
              defaultValue={
                submittedValues?.durationMinutes ??
                (play ? (play.durationMinutes ?? "") : 30)
              }
              disabled={playType === "reminder"}
              max={1440}
              min={1}
              name="durationMinutes"
              placeholder="Duration (minutes)"
              step={1}
              type="number"
            />
            <FieldError errors={state.fieldErrors} field="durationMinutes" />
          </label>
          <label className="field compactField">
            <span className="srOnly">Push</span>
            <select
              aria-label="Push"
              defaultValue={submittedValues?.pushRule ?? play?.pushRule ?? "everyday"}
              key={submittedValues?.pushRule ?? "initial"}
              name="pushRule"
            >
              <option value="everyday">Push: Everyday</option>
              <option value="weekdays">Push: Weekdays</option>
              <option value="weekends">Push: Weekends</option>
            </select>
            <FieldError errors={state.fieldErrors} field="pushRule" />
          </label>
        </div>

        <label className="field compactField field--wide">
          <span className="srOnly">Note</span>
          <textarea
            aria-label="Note"
            defaultValue={submittedValues?.note ?? play?.note ?? ""}
            maxLength={10000}
            name="note"
            placeholder="Note"
            rows={1}
          />
          <FieldError errors={state.fieldErrors} field="note" />
        </label>

        <div className="formFooter field--wide">
          <button className="primaryButton" disabled={isPending} type="submit">
            {isPending ? "Saving…" : isEditing ? "Save changes" : "Create Play"}
          </button>
          {state.status === "error" && state.message ? (
            <p className="formError" role="alert">
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
      {play && supportsWorkflows ? (
        <div className="editWorkflowArea">
          <NextPlayRelationshipForm
            currentNextPlayId={play.nextPlayId}
            options={nextPlayOptions}
            playId={play.id}
          />
          <PlayWorkflowActions
            baskets={baskets}
            defaultPlacement={initialPlacement}
            nextPlay={nextPlayOptions.find((option) => option.id === play.nextPlayId)}
            play={play}
          />
        </div>
      ) : null}
    </details>
  );
}
