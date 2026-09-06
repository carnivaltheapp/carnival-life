import type { PlayListItem } from "./play";
import { playRankSortValue } from "./play-visual";

export function comparePlayRankAndPriority(
  left: PlayListItem,
  right: PlayListItem,
) {
  const rankOrder = playRankSortValue(left) - playRankSortValue(right);
  return rankOrder || (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
}

export function compareChronologicalPlays(
  left: PlayListItem,
  right: PlayListItem,
) {
  const dateOrder = (left.scheduledDate ?? "").localeCompare(right.scheduledDate ?? "");
  return dateOrder || comparePlayRankAndPriority(left, right);
}

export function sortChronologicalPlays(plays: PlayListItem[]) {
  return [...plays].sort(compareChronologicalPlays);
}
