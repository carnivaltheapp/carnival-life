import type { PlayListItem } from "./play";
import { playRankSortValue } from "./play-visual";

export function optimisticallyRepositionPlays({
  beforePlayId,
  keepInCurrentView,
  playIds,
  plays,
}: {
  beforePlayId: string | null;
  keepInCurrentView: boolean;
  playIds: string[];
  plays: PlayListItem[];
}) {
  const movingIds = new Set(playIds);
  const moving = plays.filter((play) => movingIds.has(play.id));
  const remaining = plays.filter((play) => !movingIds.has(play.id));
  if (!keepInCurrentView) return remaining;

  const requestedIndex = beforePlayId
    ? remaining.findIndex((play) => play.id === beforePlayId)
    : -1;
  const insertionIndex = requestedIndex >= 0 ? requestedIndex : remaining.length;
  const repositioned = [
    ...remaining.slice(0, insertionIndex),
    ...moving,
    ...remaining.slice(insertionIndex),
  ];

  // The inserted order represents the new priority order. A stable rank sort keeps
  // Appointment -> Headline -> Reminder grouping authoritative without waiting for a reload.
  return repositioned
    .map((play, index) => ({ index, play }))
    .sort((left, right) =>
      playRankSortValue(left.play) - playRankSortValue(right.play) ||
      left.index - right.index
    )
    .map(({ play }) => play);
}
