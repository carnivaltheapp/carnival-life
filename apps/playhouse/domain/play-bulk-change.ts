import type { PlayListItem, PlayPlacement, PlayType, PushRule } from "./play";
import { playVisualForPlay } from "./play-visual";

export type BulkPlayChange =
  | { kind: "move"; placement: PlayPlacement }
  | { kind: "rank"; playType: PlayType }
  | { kind: "push"; pushRule: PushRule };

export function isBulkSelectablePlay(
  play: Pick<PlayListItem, "contextType" | "legacyTaskType" | "playType" | "sourceMetadata">,
) {
  const visualType = playVisualForPlay(play).visualType;
  return visualType !== "appointment" && visualType !== "place";
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
      return [{
        ...play,
        legacyTaskType: change.playType === "reminder" ? "S" : "H",
        playType: change.playType,
      }];
    }
    return [{ ...play, pushRule: change.pushRule }];
  });
}

export function optimisticallyFlipPlayRank(
  plays: PlayListItem[],
  playId: string,
  playType: PlayType,
  keepMovedInView: boolean,
) {
  const source = plays.find((play) => play.id === playId);
  if (!source || !isBulkSelectablePlay(source)) return plays;
  const changed = optimisticallyApplyBulkChange(
    plays,
    new Set([playId]),
    { kind: "rank", playType },
    keepMovedInView,
  );
  const flipped = changed.find((play) => play.id === playId);
  if (!flipped) return changed;
  const targetVisualType = playType === "reminder" ? "reminder" : "headline";
  const peerOrders = changed.flatMap((play) =>
    play.id !== playId &&
      playVisualForPlay(play).visualType === targetVisualType &&
      play.scheduledDate === flipped.scheduledDate &&
      play.basketId === flipped.basketId
      ? [play.sortOrder ?? 0]
      : []
  );
  const topOrder = (peerOrders.length ? Math.min(...peerOrders) : 0) - 1;
  return changed.map((play) => play.id === playId
    ? { ...play, sortOrder: topOrder }
    : play);
}
