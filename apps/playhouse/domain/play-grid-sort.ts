import type { PlayListItem } from "./play";
import { displayBranch } from "./play-display";

export type PlayGridSort = {
  column: "assignee" | "branch" | "description";
  direction: "asc" | "desc";
};

function sortValue(play: PlayListItem, column: PlayGridSort["column"]) {
  if (column === "assignee") return play.playerDisplayName?.trim() ?? "";
  if (column === "branch") return displayBranch(play.branch)?.trim() ?? "";
  return play.title.trim();
}

export function sortPlaysForGrid(
  plays: PlayListItem[],
  sort: PlayGridSort | null,
) {
  if (!sort) return plays;

  return plays
    .map((play, index) => ({ index, play, value: sortValue(play, sort.column) }))
    .sort((left, right) => {
      if (!left.value && right.value) return 1;
      if (left.value && !right.value) return -1;
      const compared = left.value.localeCompare(right.value, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return (sort.direction === "asc" ? compared : -compared) || left.index - right.index;
    })
    .map(({ play }) => play);
}
