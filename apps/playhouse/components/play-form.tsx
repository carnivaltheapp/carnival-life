"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { savePlay } from "../app/plays/actions";
import type {
  BasketSummary,
  ContactReferenceOption,
  NextPlayOption,
  PlayListItem,
  PlayPlacement,
  PlayType,
} from "../domain/play";
import type { PlayInputField } from "../domain/play-input";
import { INITIAL_PLAY_MUTATION_STATE } from "../domain/play-mutation";
import { NextPlayRelationshipForm } from "./next-play-relationship-form";
import { applySuccessfulPlaySave } from "./play-form-success";

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
  contacts,
  defaultPlacement,
  nextPlayOptions,
  play,
}: {
  baskets: BasketSummary[];
  contacts: ContactReferenceOption[];
  defaultPlacement: PlayPlacement;
  nextPlayOptions: NextPlayOption[];
  play?: PlayListItem;
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
      <summary>{isEditing ? "Edit" : "+ New Play"}</summary>
      <form action={formAction} className="playForm" noValidate>
        {play ? <input name="playId" type="hidden" value={play.id} /> : null}

        <label className="field compactField field--wide">
          <span className="controlLabel">Title</span>
          <input
            aria-invalid={Boolean(state.fieldErrors?.title)}
            defaultValue={submittedValues?.title ?? play?.title}
            maxLength={500}
            name="title"
            placeholder="What would you like to do?"
            required
          />
          <FieldError errors={state.fieldErrors} field="title" />
        </label>

        <div className="formRow field--wide">
          <label className="field compactField">
            <span className="controlLabel">Type</span>
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
          <label className="field compactField">
            <span className="controlLabel">Placement</span>
            <select
              name="placementKind"
              onChange={(event) =>
                setPlacementKind(event.target.value as "calendar" | "basket")
              }
              value={placementKind}
            >
              <option value="calendar">Calendar date</option>
              <option value="basket">Basket</option>
            </select>
            <FieldError errors={state.fieldErrors} field="placement" />
          </label>
        </div>

        <label className="field compactField field--wide">
          <span className="controlLabel">Player</span>
          <select
            aria-invalid={Boolean(state.fieldErrors?.playerContactId)}
            defaultValue={submittedValues?.playerContactId ?? play?.playerContactId ?? ""}
            key={submittedValues?.playerContactId ?? "initial"}
            name="playerContactId"
          >
            <option value="">No Player</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.displayName}
              </option>
            ))}
          </select>
          <FieldError errors={state.fieldErrors} field="playerContactId" />
        </label>

        <div className="formRow dateUrlRow field--wide">
          {placementKind === "calendar" ? (
            <label className="field compactField">
              <span className="controlLabel">Date</span>
              <input
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
              <span className="controlLabel">Basket</span>
              <select
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
            <span className="controlLabel">URL</span>
            <input
              defaultValue={submittedValues?.url ?? play?.url ?? ""}
              maxLength={2048}
              name="url"
              placeholder="https://…"
              type="url"
            />
            <FieldError errors={state.fieldErrors} field="url" />
          </label>
        </div>

        <div className="formRow field--wide">
          <label className="field compactField">
            <span className="controlLabel">Branch</span>
            <input
              defaultValue={submittedValues?.branch ?? play?.branch ?? ""}
              maxLength={200}
              name="branch"
              placeholder="Optional"
            />
            <FieldError errors={state.fieldErrors} field="branch" />
          </label>
          <label className="field compactField">
            <span className="controlLabel">Place</span>
            <select
              defaultValue={
                submittedValues?.place ?? (play ? (play.place ?? "") : "office")
              }
              key={submittedValues?.place ?? "initial"}
              name="place"
            >
              <option value="">Unspecified</option>
              {hasNonstandardPlace ? (
                <option value={play?.place ?? ""}>{play?.place}</option>
              ) : null}
              <option value="office">Office</option>
              <option value="outside">Outside</option>
              <option value="any">Any</option>
            </select>
            <FieldError errors={state.fieldErrors} field="place" />
          </label>
        </div>

        <div className="formRow field--wide">
          <label className="field compactField">
            <span className="controlLabel">Duration (minutes)</span>
            <input
              defaultValue={
                submittedValues?.durationMinutes ??
                (play ? (play.durationMinutes ?? "") : 30)
              }
              disabled={playType === "reminder"}
              max={1440}
              min={1}
              name="durationMinutes"
              step={1}
              type="number"
            />
            <FieldError errors={state.fieldErrors} field="durationMinutes" />
          </label>
          <label className="field compactField">
            <span className="controlLabel">Push</span>
            <select
              defaultValue={submittedValues?.pushRule ?? play?.pushRule ?? "everyday"}
              key={submittedValues?.pushRule ?? "initial"}
              name="pushRule"
            >
              <option value="everyday">Everyday</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekends">Weekends</option>
            </select>
            <FieldError errors={state.fieldErrors} field="pushRule" />
          </label>
        </div>

        <label className="field compactField field--wide">
          <span className="controlLabel">Note</span>
          <textarea
            defaultValue={submittedValues?.note ?? play?.note ?? ""}
            maxLength={10000}
            name="note"
            placeholder="Add a note…"
            rows={2}
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
      {play ? (
        <NextPlayRelationshipForm
          currentNextPlayId={play.nextPlayId}
          options={nextPlayOptions}
          playId={play.id}
        />
      ) : null}
    </details>
  );
}
