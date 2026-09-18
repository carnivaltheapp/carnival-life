"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import { markPlayDone, savePlay, trashPlay } from "../app/plays/actions";
import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
  PlayPlacement,
  PlayType,
} from "../domain/play";
import type { PlayInputField } from "../domain/play-input";
import { INITIAL_PLAY_MUTATION_STATE } from "../domain/play-mutation";
import { reminderDateError } from "../domain/reminder";
import { playVisualForPlay } from "../domain/play-visual";
import { openInAuxAndWait } from "../lib/desktop/open-in-aux";
import { PLAYER_SLACK_UPDATED_EVENT, usableSlackUrl } from "../lib/google/contact-slack";
import { NextPlayRelationshipForm } from "./next-play-relationship-form";
import {
  createDescriptionClickController,
  routePlayDescriptionAux,
} from "./play-description-aux";
import {
  descriptionIsTruncated,
  descriptionTooltipPosition,
  type DescriptionTooltipPosition,
} from "./play-description-tooltip";
import { applySuccessfulPlaySave } from "./play-form-success";
import { AllFolderNavigator } from "./all-folder-navigator";
import { BranchPicker } from "./branch-picker";
import { PlayerCombobox } from "./player-combobox";
import { PlayerContactInfo } from "./player-contact-info";
import { PlayerSlackField } from "./player-slack-field";
import { PlayInfo, PlayWorkflowActions } from "./play-status-actions";

const PLACE_OPTIONS = ["office", "outside", "any"] as const;

function FieldError({ field, errors }: {
  field: PlayInputField;
  errors: Partial<Record<PlayInputField, string>> | undefined;
}) {
  const message = errors?.[field];
  return message ? <small className="fieldError">{message}</small> : null;
}

export function ReminderDatePrompt({
  dialogId,
  message,
  minimumDate,
  onCancel,
  onChange,
  onConfirm,
  value,
}: {
  dialogId: string;
  message: string | null;
  minimumDate: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onConfirm: () => void;
  value: string;
}) {
  if (typeof document === "undefined") return null;
  return createPortal((
    <div className="reminderDateOverlay" role="presentation">
      <section
        aria-labelledby={dialogId}
        aria-modal="true"
        className="reminderDatePrompt"
        role="dialog"
      >
        <h2 id={dialogId}>Reminder Date</h2>
        <input
          aria-label="Reminder Date"
          min={minimumDate}
          onChange={(event) => onChange(event.target.value)}
          type="date"
          value={value}
        />
        {message ? <small className="fieldError" role="alert">{message}</small> : null}
        <div className="reminderDateActions">
          <button className="secondaryButton" onClick={onCancel} type="button">Cancel</button>
          <button className="primaryButton" onClick={onConfirm} type="button">Set Reminder</button>
        </div>
      </section>
    </div>
  ), document.body);
}

export function PlayForm({
  baskets,
  defaultPlacement,
  nextPlayOptions,
  play,
  supportsWorkflows,
  reminderContextDate,
  slackUrl = null,
}: {
  baskets: BasketSummary[];
  defaultPlacement: PlayPlacement;
  nextPlayOptions: NextPlayOption[];
  play?: PlayListItem;
  supportsWorkflows: boolean;
  reminderContextDate: string;
  slackUrl?: string | null;
}) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const titleRef = useRef<HTMLElement>(null);
  const [formResetVersion, setFormResetVersion] = useState(0);
  const [descriptionTooltip, setDescriptionTooltip] =
    useState<DescriptionTooltipPosition | null>(null);
  const initialPlacement: PlayPlacement = play
    ? play.basketId
      ? { basketId: play.basketId, kind: "basket" }
      : { kind: "calendar", scheduledDate: play.scheduledDate ?? "" }
    : defaultPlacement;
  const [placementKind, setPlacementKind] = useState(initialPlacement.kind);
  const [playType, setPlayType] = useState<PlayType>(play?.playType ?? "normal");
  const [scheduledDate, setScheduledDate] = useState(
    initialPlacement.kind === "calendar" ? initialPlacement.scheduledDate : "",
  );
  const [reminderDate, setReminderDate] = useState("");
  const [reminderDateMessage, setReminderDateMessage] = useState<string | null>(null);
  const [showReminderDate, setShowReminderDate] = useState(false);
  const [saveFollowupError, setSaveFollowupError] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState(
    savePlay,
    INITIAL_PLAY_MUTATION_STATE,
  );
  const [trashState, trashAction, trashPending] = useActionState(
    trashPlay,
    INITIAL_PLAY_MUTATION_STATE,
  );
  const [doneState, doneAction, donePending] = useActionState(
    markPlayDone,
    INITIAL_PLAY_MUTATION_STATE,
  );
  const lifecyclePending = donePending || trashPending;
  const completedStateRef = useRef<typeof state | null>(null);
  const completedTrashStateRef = useRef<typeof trashState | null>(null);
  const completedDoneStateRef = useRef<typeof doneState | null>(null);
  const isEditing = Boolean(play);
  const isAppointment = play ? playVisualForPlay(play).visualType === "appointment" : false;
  const hasNonstandardPlace = Boolean(
    play?.place && !PLACE_OPTIONS.some((place) => place === play.place),
  );
  const submittedValues = formResetVersion === 0 ? state.values : undefined;
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
  const [selectedPlayerId, setSelectedPlayerId] = useState(initialPlayer?.id ?? null);
  const initialBranch = submittedValues?.branch ?? play?.branch ?? "";
  const [branchValue, setBranchValue] = useState(initialBranch);
  const [branchTreeVersion, setBranchTreeVersion] = useState(0);
  const [showAllFolders, setShowAllFolders] = useState(false);
  const [descriptionClick] = useState(createDescriptionClickController);
  const formId = `play-form-${play?.id ?? "new"}`;
  const backlogBasketId = baskets.find((basket) =>
    basket.slug.toLowerCase() === "backlog" || basket.name.toLowerCase() === "backlog"
  )?.id ?? baskets[0]?.id;

  useEffect(() => () => descriptionClick.dispose(), [descriptionClick]);

  useEffect(() => {
    if (state.status !== "success" || completedStateRef.current === state) return;
    completedStateRef.current = state;
    const finish = () => applySuccessfulPlaySave(state.status, {
      close: () => detailsRef.current?.removeAttribute("open"),
      refresh: () => router.refresh(),
    });
    if (!state.slackUpdated) {
      finish();
      return;
    }
    const { playerContactId, slack, slackName } = state.slackUpdated;
    window.dispatchEvent(new CustomEvent(PLAYER_SLACK_UPDATED_EVENT, {
      detail: { playerContactId, slack, slackName },
    }));
    const destination = usableSlackUrl(slack);
    if (!destination) {
      finish();
      return;
    }
    void openInAuxAndWait(destination).then((opened) => {
      if (opened) finish();
      else {
        setSaveFollowupError("Slack was saved, but could not be opened in Aux.");
        router.refresh();
      }
    });
  }, [router, state]);

  useEffect(() => {
    if (
      !play || trashState.status !== "success" ||
      completedTrashStateRef.current === trashState
    ) return;
    completedTrashStateRef.current = trashState;
    if (trashState.warning) {
      window.dispatchEvent(new CustomEvent("carnival:play-lifecycle-warning", {
        detail: trashState.warning,
      }));
    }
    detailsRef.current?.removeAttribute("open");
    router.refresh();
  }, [play, router, trashState]);

  useEffect(() => {
    if (
      !play || doneState.status !== "success" ||
      completedDoneStateRef.current === doneState
    ) return;
    completedDoneStateRef.current = doneState;
    if (doneState.warning) {
      window.dispatchEvent(new CustomEvent("carnival:play-lifecycle-warning", {
        detail: doneState.warning,
      }));
    }
    detailsRef.current?.removeAttribute("open");
    router.refresh();
  }, [doneState, play, router]);

  function requestPlayType(nextPlayType: PlayType) {
    if (nextPlayType !== "reminder" || playType === "reminder") {
      setPlayType(nextPlayType);
      return;
    }
    setReminderDate(reminderContextDate);
    setReminderDateMessage(null);
    setShowReminderDate(true);
  }

  function confirmReminder() {
    const message = reminderDateError(
      { kind: "calendar", scheduledDate: reminderDate },
      reminderContextDate,
    );
    if (message) {
      setReminderDateMessage(message);
      return;
    }
    setScheduledDate(reminderDate);
    setPlacementKind("calendar");
    setPlayType("reminder");
    setShowReminderDate(false);
  }

  function cancelEdit(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setPlacementKind(initialPlacement.kind);
    setPlayType(play?.playType ?? "normal");
    setScheduledDate(
      initialPlacement.kind === "calendar" ? initialPlacement.scheduledDate : "",
    );
    setReminderDate("");
    setReminderDateMessage(null);
    setShowReminderDate(false);
    setSaveFollowupError(null);
    setSelectedPlayerId(play?.playerContactId ?? null);
    setBranchValue(play?.branch ?? "");
    setShowAllFolders(false);
    setFormResetVersion((version) => version + 1);
    detailsRef.current?.removeAttribute("open");
  }

  return (
    <details
      className={isEditing ? "editDisclosure" : "createDisclosure"}
      data-testid={isEditing ? "edit-play" : "create-play"}
      ref={detailsRef}
    >
      <summary
        aria-label={isEditing ? undefined : "New Play"}
        className={isEditing ? "playTitleLink" : undefined}
        data-testid={isEditing ? "play-title" : undefined}
        onMouseEnter={isEditing ? () => {
          const title = titleRef.current;
          if (!title || !descriptionIsTruncated(title)) return;
          setDescriptionTooltip(
            descriptionTooltipPosition(title.getBoundingClientRect(), window.innerWidth),
          );
        } : undefined}
        onMouseLeave={isEditing ? () => setDescriptionTooltip(null) : undefined}
        onClick={isEditing ? (event) => {
          event.preventDefault();
          descriptionClick.singleClick(
            event.detail,
            () => play ? routePlayDescriptionAux(play, slackUrl) : Promise.resolve(),
          );
        } : undefined}
        onDoubleClick={isEditing ? (event) => {
          event.preventDefault();
          descriptionClick.doubleClick(() => {
            setDescriptionTooltip(null);
            if (detailsRef.current) detailsRef.current.open = true;
          });
        } : undefined}
        ref={titleRef}
        title={isEditing ? undefined : "New Play"}
      >
        {isEditing
          ? <span className="playTitleText">{play?.title}</span>
          : <span aria-hidden="true">+</span>}
      </summary>
      {descriptionTooltip && play && typeof document !== "undefined"
        ? createPortal(
            <div
              className={`descriptionHoverBubble descriptionHoverBubble--${descriptionTooltip.placement}`}
              role="tooltip"
              style={{ left: descriptionTooltip.left, top: descriptionTooltip.top }}
            >
              {play.title}
            </div>,
            document.body,
          )
        : null}
      {play ? <PlayInfo play={play} /> : null}
      <form
        action={formAction}
        className={isEditing ? "playForm playDetailForm" : "playForm"}
        id={formId}
        key={formResetVersion}
        noValidate
      >
        {play ? <input name="playId" type="hidden" value={play.id} /> : null}
        <input name="reminderContextDate" type="hidden" value={reminderContextDate} />

        <section className="playDetailSection playDetailBranchSection">
          <div className="playDetailSectionHeading">
            <h2 className="playDetailSectionTitle">Branch</h2>
            {isEditing ? <button className="addBranchButton" onClick={() => setShowAllFolders(true)} type="button">+ Branch</button> : null}
          </div>
          <div className="field compactField">
            <BranchPicker
              initialBranch={branchValue}
              key={branchTreeVersion}
              onSelectionChange={setBranchValue}
            />
            <FieldError errors={state.fieldErrors} field="branch" />
          </div>
          {showAllFolders ? (
            <AllFolderNavigator
              onClose={() => setShowAllFolders(false)}
              onSelectBranch={(relativePath) => {
                setBranchValue(relativePath);
                setBranchTreeVersion((version) => version + 1);
              }}
            />
          ) : null}
        </section>

        <section className="playDetailSection playDetailWhatSection">
          <h2 className="playDetailSectionTitle">What</h2>
          <label className="field compactField">
            <span className={isEditing ? "detailFieldLabel" : "srOnly"}>Title</span>
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
          <label className="field compactField">
            <span className={isEditing ? "detailFieldLabel" : "srOnly"}>Notes</span>
            <textarea
              aria-label="Note"
              defaultValue={submittedValues?.note ?? play?.note ?? ""}
              maxLength={10000}
              name="note"
              placeholder="Notes"
              rows={isEditing ? 4 : 1}
            />
            <FieldError errors={state.fieldErrors} field="note" />
          </label>
        </section>

        <section className="playDetailSection playDetailWhenSection">
          <h2 className="playDetailSectionTitle">When &amp; Where</h2>
          <div className="playDetailThreeColumnRow">
            <label className="field compactField">
              <span className={isEditing ? "detailFieldLabel" : "srOnly"}>Placement</span>
              <select
                aria-label="Placement"
                disabled={playType === "reminder"}
                name={playType === "reminder" ? undefined : "placementKind"}
                onChange={(event) =>
                  setPlacementKind(event.target.value as "calendar" | "basket")
                }
                value={placementKind}
              >
                <option value="calendar">Calendar</option>
                <option value="basket">Baskets</option>
              </select>
              {playType === "reminder" ? (
                <input name="placementKind" type="hidden" value="calendar" />
              ) : null}
              <FieldError errors={state.fieldErrors} field="placement" />
            </label>
            <label className="field compactField">
              <span className={isEditing ? "detailFieldLabel" : "srOnly"}>Rank</span>
              {isAppointment ? <input name="playType" type="hidden" value="normal" /> : null}
              <select
                aria-label="Type"
                disabled={isAppointment}
                name={isAppointment ? undefined : "playType"}
                onChange={(event) => requestPlayType(event.target.value as PlayType)}
                value={playType}
              >
                <option value="normal">{isAppointment ? "Appointment" : "Headline"}</option>
                <option value="reminder">Reminder</option>
              </select>
              <FieldError errors={state.fieldErrors} field="playType" />
            </label>
            <label className="field compactField">
              <span className={isEditing ? "detailFieldLabel" : "srOnly"}>Push</span>
              <select
                aria-label="Push"
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

          {placementKind === "calendar" ? (
            <div className="playDetailCalendarRow">
            <label className="field compactField">
              <span className={isEditing ? "detailFieldLabel" : "srOnly"}>Date</span>
              <input
                aria-label="Date"
                aria-invalid={Boolean(state.fieldErrors?.scheduledDate)}
                min={playType === "reminder" ? reminderContextDate : undefined}
                name="scheduledDate"
                onChange={(event) => setScheduledDate(event.target.value)}
                required
                type="date"
                value={scheduledDate}
              />
              <FieldError errors={state.fieldErrors} field="scheduledDate" />
            </label>
              <label className="field compactField">
                <span className={isEditing ? "detailFieldLabel" : "srOnly"}>Duration</span>
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
                  placeholder="Minutes"
                  step={1}
                  type="number"
                />
                <FieldError errors={state.fieldErrors} field="durationMinutes" />
              </label>
            </div>
          ) : (
            <div className="playDetailBasketRow">
            <label className="field compactField">
              <span className={isEditing ? "detailFieldLabel" : "srOnly"}>Basket</span>
              <select
                aria-label="Basket"
                aria-invalid={Boolean(state.fieldErrors?.basketId)}
                defaultValue={
                  submittedValues?.basketId ??
                  (initialPlacement.kind === "basket"
                    ? initialPlacement.basketId
                    : backlogBasketId)
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
            </div>
          )}

          <div className="playDetailTwoColumnRow">
            <label className="field compactField">
              <span className={isEditing ? "detailFieldLabel" : "srOnly"}>Place</span>
              <select
                aria-label="Place"
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
            <label className="field compactField">
              <span className={isEditing ? "detailFieldLabel" : "srOnly"}>URL</span>
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
        </section>

        <section className="playDetailSection playDetailPeopleSection">
          <h2 className="playDetailSectionTitle">People &amp; Integrations</h2>
          <div className="playDetailPeopleRow">
            <div className="field compactField">
              <span className={isEditing ? "detailFieldLabel" : "srOnly"}>Player / Contact</span>
              <div className="playerInfoRow">
                <PlayerCombobox
                  error={state.fieldErrors?.playerContactId}
                  initialSelection={initialPlayer}
                  key={`${submittedPlayerId ?? play?.playerContactId ?? "none"}:${submittedPlayerName ?? play?.playerDisplayName ?? ""}`}
                  onSelectionChange={(selection) => setSelectedPlayerId(selection?.id ?? null)}
                />
                <PlayerContactInfo playerContactId={selectedPlayerId} />
              </div>
            </div>
            <div className="field compactField">
              <span className={isEditing ? "detailFieldLabel" : "srOnly"}>Slack</span>
              <PlayerSlackField key={selectedPlayerId ?? "none"} playerContactId={selectedPlayerId} />
            </div>
            {isEditing ? (
              <div className="field compactField">
                <span className="detailFieldLabel">Jira</span>
                <div aria-disabled="true" className="jiraPlaceholder">
                  <span aria-hidden="true">J</span>
                  <span>Jira</span>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {!isEditing ? (
          <div className="formFooter field--wide">
            <button className="primaryButton" disabled={isPending} type="submit">
              {isPending ? "Saving…" : "Create Play"}
            </button>
          </div>
        ) : null}
        <div className="playDetailFormMessages">
          {state.status === "error" && state.message ? (
            <p className="formError" role="alert">
              {state.message}
            </p>
          ) : null}
          {saveFollowupError ? (
            <p className="formError" role="alert">{saveFollowupError}</p>
          ) : null}
          {trashState.status === "error" && trashState.message ? (
            <p className="formError" role="alert">{trashState.message}</p>
          ) : null}
          {doneState.status === "error" && doneState.message ? (
            <p className="formError" role="alert">{doneState.message}</p>
          ) : null}
        </div>
      </form>
      {showReminderDate ? (
        <ReminderDatePrompt
          dialogId={`reminder-date-title-${play?.id ?? "new"}`}
          message={reminderDateMessage}
          minimumDate={reminderContextDate}
          onCancel={() => setShowReminderDate(false)}
          onChange={(value) => {
            setReminderDate(value);
            setReminderDateMessage(null);
          }}
          onConfirm={confirmReminder}
          value={reminderDate}
        />
      ) : null}
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
      {play ? (
        <div className="playDetailActions">
          <div className="playDetailDestructiveActions">
            <form action={doneAction}>
              <input name="playId" type="hidden" value={play.id} />
              <button className="detailDoneButton" disabled={lifecyclePending} type="submit">
                {donePending ? "Finishing…" : "✓ Done"}
              </button>
            </form>
            <form action={trashAction}>
              <input name="playId" type="hidden" value={play.id} />
              <button className="detailTrashButton" disabled={lifecyclePending} type="submit">
                {trashPending ? "Trashing…" : "Trash"}
              </button>
            </form>
          </div>
          <div className="playDetailSaveActions">
            <button
              className="secondaryButton"
              onClick={cancelEdit}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              Cancel
            </button>
            <button className="primaryButton" disabled={isPending} form={formId} type="submit">
              {isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}
    </details>
  );
}
