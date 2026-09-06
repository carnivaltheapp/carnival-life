import type { PlayListItem, PlayType } from "./play";

export type PlayVisualType = "appointment" | "headline" | "reminder";

export const PLAY_VISUALS = {
  appointment: {
    className: "playVisual--appointment",
    label: "Appointment",
    markerClassName: "playTypeMarker--appointment",
    visualType: "appointment",
  },
  headline: {
    className: "playVisual--headline",
    label: "Headline",
    markerClassName: "playTypeMarker--headline",
    visualType: "headline",
  },
  reminder: {
    className: "playVisual--reminder",
    label: "Reminder",
    markerClassName: "playTypeMarker--reminder",
    visualType: "reminder",
  },
} as const satisfies Record<PlayVisualType, {
  className: string;
  label: string;
  markerClassName: string;
  visualType: PlayVisualType;
}>;

function sourceTaskType(sourceMetadata: unknown) {
  if (typeof sourceMetadata !== "object" || sourceMetadata === null) return null;
  const legacySource = (sourceMetadata as Record<string, unknown>).legacy_source;
  if (typeof legacySource !== "object" || legacySource === null) return null;
  const taskType = (legacySource as Record<string, unknown>).task_type;
  return typeof taskType === "string" ? taskType : null;
}

export function playVisualForType(playType: PlayType, legacyTaskType?: string | null) {
  if (legacyTaskType === "A") return PLAY_VISUALS.appointment;
  if (legacyTaskType === "S") return PLAY_VISUALS.reminder;
  if (legacyTaskType !== undefined && legacyTaskType !== null) {
    return PLAY_VISUALS.headline;
  }
  return playType === "reminder" ? PLAY_VISUALS.reminder : PLAY_VISUALS.headline;
}

export function playVisualForPlay(
  play: Pick<PlayListItem, "legacyTaskType" | "playType" | "sourceMetadata">,
) {
  return playVisualForType(
    play.playType,
    play.legacyTaskType ?? sourceTaskType(play.sourceMetadata),
  );
}
