"use client";

import { useActionState, useState } from "react";

import { savePlay } from "../app/plays/actions";
import type {
  BasketSummary,
  PlayListItem,
  PlayPlacement,
  PlayType,
} from "../domain/play";
import type { PlayInputField } from "../domain/play-input";
import { INITIAL_PLAY_MUTATION_STATE } from "../domain/play-mutation";

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
  play,
}: {
  baskets: BasketSummary[];
  defaultPlacement: PlayPlacement;
  play?: PlayListItem;
}) {
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

  return (
    <details className={isEditing ? "editDisclosure" : "createDisclosure"}>
      <summary>{isEditing ? "Edit" : "+ New Play"}</summary>
      <form action={formAction} className="playForm" noValidate>
        {play ? <input name="playId" type="hidden" value={play.id} /> : null}

        <label className="field field--wide">
          <span>Title</span>
          <input
            aria-invalid={Boolean(state.fieldErrors?.title)}
            defaultValue={play?.title}
            maxLength={500}
            name="title"
            placeholder="What would you like to do?"
            required
          />
          <FieldError errors={state.fieldErrors} field="title" />
        </label>

        <label className="field">
          <span>Type</span>
          <select
            name="playType"
            onChange={(event) => setPlayType(event.target.value as PlayType)}
            value={playType}
          >
            <option value="normal">Normal</option>
            <option value="reminder">Reminder</option>
          </select>
          <FieldError errors={state.fieldErrors} field="playType" />
        </label>

        <label className="field">
          <span>Placement</span>
          <select
            name="placementKind"
            onChange={(event) => setPlacementKind(event.target.value as "calendar" | "basket")}
            value={placementKind}
          >
            <option value="calendar">Calendar date</option>
            <option value="basket">Basket</option>
          </select>
          <FieldError errors={state.fieldErrors} field="placement" />
        </label>

        {placementKind === "calendar" ? (
          <label className="field field--wide">
            <span>Date</span>
            <input
              aria-invalid={Boolean(state.fieldErrors?.scheduledDate)}
              defaultValue={
                initialPlacement.kind === "calendar" ? initialPlacement.scheduledDate : ""
              }
              name="scheduledDate"
              required
              type="date"
            />
            <FieldError errors={state.fieldErrors} field="scheduledDate" />
          </label>
        ) : (
          <label className="field field--wide">
            <span>Basket</span>
            <select
              aria-invalid={Boolean(state.fieldErrors?.basketId)}
              defaultValue={
                initialPlacement.kind === "basket"
                  ? initialPlacement.basketId
                  : baskets[0]?.id
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

        <label className="field">
          <span>Branch</span>
          <input defaultValue={play?.branch ?? ""} maxLength={200} name="branch" />
          <FieldError errors={state.fieldErrors} field="branch" />
        </label>

        <label className="field">
          <span>Place</span>
          <input defaultValue={play?.place ?? ""} maxLength={200} name="place" />
          <FieldError errors={state.fieldErrors} field="place" />
        </label>

        <label className="field">
          <span>Duration (minutes)</span>
          <input
            defaultValue={play?.durationMinutes ?? ""}
            disabled={playType === "reminder"}
            max={1440}
            min={1}
            name="durationMinutes"
            step={1}
            type="number"
          />
          <small className="fieldHint">
            {playType === "reminder" ? "Ignored while this Play is a Reminder." : "Optional"}
          </small>
          <FieldError errors={state.fieldErrors} field="durationMinutes" />
        </label>

        <label className="field">
          <span>Push</span>
          <select defaultValue={play?.pushRule ?? "everyday"} name="pushRule">
            <option value="everyday">Everyday</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekends">Weekends</option>
          </select>
          <FieldError errors={state.fieldErrors} field="pushRule" />
        </label>

        <label className="field field--wide">
          <span>URL</span>
          <input
            defaultValue={play?.url ?? ""}
            maxLength={2048}
            name="url"
            placeholder="https://…"
            type="url"
          />
          <FieldError errors={state.fieldErrors} field="url" />
        </label>

        <label className="field field--wide">
          <span>Note</span>
          <textarea defaultValue={play?.note ?? ""} maxLength={10000} name="note" rows={4} />
          <FieldError errors={state.fieldErrors} field="note" />
        </label>

        <p className="playerDeferred field--wide">
          Player selection will become available when Google Contacts are connected. No
          contact data is created or guessed here.
        </p>

        <div className="formFooter field--wide">
          <button className="primaryButton" disabled={isPending} type="submit">
            {isPending ? "Saving…" : isEditing ? "Save changes" : "Create Play"}
          </button>
          {state.message ? (
            <p
              className={state.status === "error" ? "formError" : "formSuccess"}
              role={state.status === "error" ? "alert" : "status"}
            >
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
    </details>
  );
}
