import type { PlayListItem } from "./play";
import { displayBranch, usablePlayUrl } from "./play-display";

export type PlayGridSort = {
  column: "assignee" | "branch" | "description" | "gmail" | "url";
  direction: "asc" | "desc";
};

function sortValue(play: PlayListItem, column: PlayGridSort["column"]) {
  if (column === "assignee") return play.playerDisplayName?.trim() ?? "";
  if (column === "branch") return displayBranch(play.branch)?.trim() ?? "";
  if (column === "gmail") return play.gmailThreadId?.trim() ? "linked" : "";
  if (column === "url") return usablePlayUrl(play.url) ? "linked" : "";
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
      if (sort.column === "gmail" || sort.column === "url") {
        if (Boolean(left.value) !== Boolean(right.value)) {
          const linkedFirst = sort.direction === "asc";
          return Boolean(left.value) === linkedFirst ? -1 : 1;
        }
        return left.index - right.index;
      }
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
