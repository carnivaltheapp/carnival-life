import type { PlayListItem } from "./play";
import { playRankSortValue } from "./play-visual";

export function compareChronologicalPlays(
  left: PlayListItem,
  right: PlayListItem,
) {
  const dateOrder = (left.scheduledDate ?? "").localeCompare(right.scheduledDate ?? "");
  if (dateOrder) return dateOrder;

  const rankOrder = playRankSortValue(left) - playRankSortValue(right);
  if (rankOrder) return rankOrder;

  return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
}

export function sortChronologicalPlays(plays: PlayListItem[]) {
  return [...plays].sort(compareChronologicalPlays);
}
