import type { PlayType } from "./play";

export type PlayVisualType = "appointment" | "headline" | "reminder";

export const PLAY_VISUALS = {
  appointment: {
    className: "playTypeMarker--appointment",
    label: "Appointment",
    visualType: "appointment",
  },
  headline: {
    className: "playTypeMarker--headline",
    label: "Headline",
    visualType: "headline",
  },
  reminder: {
    className: "playTypeMarker--reminder",
    label: "Reminder",
    visualType: "reminder",
  },
} as const satisfies Record<PlayVisualType, {
  className: string;
  label: string;
  visualType: PlayVisualType;
}>;

export function playVisualForType(playType: PlayType) {
  return playType === "reminder" ? PLAY_VISUALS.reminder : PLAY_VISUALS.headline;
}
