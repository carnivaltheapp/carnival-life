import type { PlayListItem, PlayType } from "./play";

export type PlayVisualType = "appointment" | "headline" | "place" | "reminder";

export const PLAY_VISUALS = {
  appointment: {
    backgroundColor: "#FF1717",
    className: "playVisual--appointment",
    foregroundColor: "#FFFFFF",
    label: "Appointment",
    visualType: "appointment",
  },
  headline: {
    backgroundColor: "#FF9800",
    className: "playVisual--headline",
    foregroundColor: "#111111",
    label: "Headline",
    visualType: "headline",
  },
  place: {
    backgroundColor: "#DCECF7",
    className: "playVisual--place",
    foregroundColor: "#173A52",
    label: "Place",
    visualType: "place",
  },
  reminder: {
    backgroundColor: "#55F238",
    className: "playVisual--reminder",
    foregroundColor: "#111111",
    label: "Reminder",
    visualType: "reminder",
  },
} as const satisfies Record<PlayVisualType, {
  backgroundColor: string;
  className: string;
  foregroundColor: string;
  label: string;
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
  return playType === "reminder" ? PLAY_VISUALS.reminder : PLAY_VISUALS.headline;
}

export function playVisualForPlay(
  play: Pick<PlayListItem, "contextType" | "legacyTaskType" | "playType" | "sourceMetadata">,
) {
  if (play.contextType === "place") return PLAY_VISUALS.place;
  return playVisualForType(
    play.playType,
    play.legacyTaskType ?? legacyTaskTypeFromMetadata(play.sourceMetadata),
  );
}

export function playRankSortValue(
  play: Pick<PlayListItem, "contextType" | "legacyTaskType" | "playType" | "sourceMetadata">,
) {
  const visualType = playVisualForPlay(play).visualType;
  if (visualType === "place") return -1;
  if (visualType === "appointment") return 0;
  return visualType === "reminder" ? 2 : 1;
}
