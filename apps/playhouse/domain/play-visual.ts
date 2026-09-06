import type { PlayListItem, PlayType } from "./play";

export type PlayVisualType = "appointment" | "headline" | "reminder";

export const PLAY_VISUALS = {
  appointment: {
    backgroundColor: "#FF0000",
    className: "playVisual--appointment",
    foregroundColor: "#120000",
    label: "Appointment",
    markerClassName: "playTypeMarker--appointment",
    ringColor: "rgba(18, 0, 0, 0.32)",
    visualType: "appointment",
  },
  headline: {
    backgroundColor: "#FF9900",
    className: "playVisual--headline",
    foregroundColor: "#16110A",
    label: "Headline",
    markerClassName: "playTypeMarker--headline",
    ringColor: "rgba(22, 17, 10, 0.3)",
    visualType: "headline",
  },
  reminder: {
    backgroundColor: "#55FF33",
    className: "playVisual--reminder",
    foregroundColor: "#10200C",
    label: "Reminder",
    markerClassName: "playTypeMarker--reminder",
    ringColor: "rgba(16, 32, 12, 0.3)",
    visualType: "reminder",
  },
} as const satisfies Record<PlayVisualType, {
  backgroundColor: string;
  className: string;
  foregroundColor: string;
  label: string;
  markerClassName: string;
  ringColor: string;
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
