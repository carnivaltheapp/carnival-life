import type { PlayListItem, PlayType } from "./play";

export type PlayVisualType = "appointment" | "headline" | "reminder";

export const PLAY_VISUALS = {
  appointment: {
    backgroundColor: "#FF1717",
    className: "playVisual--appointment",
    foregroundColor: "#FFFFFF",
    label: "Appointment",
    markerClassName: "playTypeMarker--appointment",
    visualType: "appointment",
  },
  headline: {
    backgroundColor: "#FF9800",
    className: "playVisual--headline",
    foregroundColor: "#111111",
    label: "Headline",
    markerClassName: "playTypeMarker--headline",
    visualType: "headline",
  },
  reminder: {
    backgroundColor: "#55F238",
    className: "playVisual--reminder",
    foregroundColor: "#111111",
    label: "Reminder",
    markerClassName: "playTypeMarker--reminder",
    visualType: "reminder",
  },
} as const satisfies Record<PlayVisualType, {
  backgroundColor: string;
  className: string;
  foregroundColor: string;
  label: string;
  markerClassName: string;
  visualType: PlayVisualType;
}>;

export function legacyTaskTypeFromMetadata(sourceMetadata: unknown) {
  if (typeof sourceMetadata !== "object" || sourceMetadata === null) return null;
  const legacySource = (sourceMetadata as Record<string, unknown>).legacy_source;
  if (typeof legacySource !== "object" || legacySource === null) return null;
  const taskType = (legacySource as Record<string, unknown>).task_type;
  return typeof taskType === "string" ? taskType : null;
}

export function playVisualForType(playType: PlayType, legacyTaskType?: string | null) {
  if (legacyTaskType === "A") return PLAY_VISUALS.appointment;
  if (legacyTaskType === "S" && playType === "reminder") return PLAY_VISUALS.reminder;
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
    play.legacyTaskType ?? legacyTaskTypeFromMetadata(play.sourceMetadata),
  );
}
