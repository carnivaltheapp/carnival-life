import type { PlayListItem, PlayPlacement, PlayType, PushRule } from "./play";
import { playVisualForPlay } from "./play-visual";

export type BulkPlayChange =
  | { kind: "move"; placement: PlayPlacement }
  | { kind: "rank"; playType: PlayType; reminderDate: string }
  | { kind: "push"; pushRule: PushRule }
  | { durationMinutes: number; kind: "duration" };

export function isBulkSelectablePlay(
  play: Pick<PlayListItem, "legacyTaskType" | "playType" | "sourceMetadata">,
) {
  return playVisualForPlay(play).visualType !== "appointment";
}

export function optimisticallyApplyBulkChange(
  plays: PlayListItem[],
  playIds: ReadonlySet<string>,
  change: BulkPlayChange,
  keepMovedInView: boolean,
) {
  return plays.flatMap((play) => {
    if (!playIds.has(play.id) || !isBulkSelectablePlay(play)) return [play];
    if (change.kind === "move") {
      if (!keepMovedInView) return [];
      return [{
        ...play,
        basketId: change.placement.kind === "basket" ? change.placement.basketId : null,
        scheduledDate: change.placement.kind === "calendar"
          ? change.placement.scheduledDate
          : null,
      }];
    }
    if (change.kind === "rank") {
      const preserveReminderDate = Boolean(
        play.scheduledDate &&
        play.scheduledDate >= change.reminderDate &&
        play.scheduledDate < "2200-01-01" &&
        !play.basketId,
      );
      if (change.playType === "reminder" && !preserveReminderDate && !keepMovedInView) return [];
      return [{
        ...play,
        legacyTaskType: change.playType === "reminder" ? "S" : "H",
        playType: change.playType,
        scheduledDate: change.playType === "reminder" && !preserveReminderDate
          ? change.reminderDate
          : play.scheduledDate,
        basketId: change.playType === "reminder" && !preserveReminderDate
          ? null
          : play.basketId,
      }];
    }
    if (change.kind === "push") return [{ ...play, pushRule: change.pushRule }];
    return [{ ...play, durationMinutes: change.durationMinutes }];
  });
}
