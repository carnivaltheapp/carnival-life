import type { BasketSummary, PlayListItem } from "./play";
import { comparePlayRankAndPriority } from "./play-sort";

function tokens(query: string) {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function searchableText(play: PlayListItem) {
  return [
    play.title,
    play.playerDisplayName,
    play.branch,
    play.place,
    play.note,
    play.url,
    ...(play.searchableText ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && Boolean(value))
    .join("\n")
    .toLocaleLowerCase();
}

export function searchableMetadataText(sourceMetadata: unknown) {
  if (typeof sourceMetadata !== "object" || sourceMetadata === null) return [];
  const metadata = sourceMetadata as Record<string, unknown>;
  const legacy = typeof metadata.legacy_source === "object" && metadata.legacy_source !== null
    ? metadata.legacy_source as Record<string, unknown>
    : {};
  return [metadata.email, legacy.email].filter(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
}

export function playMatchesSearch(play: PlayListItem, query: string) {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return true;
  const haystack = searchableText(play);
  return queryTokens.every((token) => haystack.includes(token));
}

function realDate(play: PlayListItem) {
  return play.scheduledDate && play.scheduledDate < "2200-01-01"
    ? play.scheduledDate
    : null;
}

export function compareSearchResults(
  left: PlayListItem,
  right: PlayListItem,
  baskets: BasketSummary[],
) {
  const leftDate = realDate(left);
  const rightDate = realDate(right);
  if (leftDate && rightDate) {
    const dateOrder = leftDate.localeCompare(rightDate);
    if (dateOrder) return dateOrder;
  } else if (leftDate || rightDate) {
    return leftDate ? -1 : 1;
  } else {
    const basketOrder = new Map(baskets.map((basket) => [basket.id, basket.sortOrder]));
    const destinationOrder = (basketOrder.get(left.basketId ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (basketOrder.get(right.basketId ?? "") ?? Number.MAX_SAFE_INTEGER);
    if (destinationOrder) return destinationOrder;
  }

  return comparePlayRankAndPriority(left, right);
}

export function searchPlays(
  plays: PlayListItem[],
  query: string,
  baskets: BasketSummary[],
) {
  return plays
    .filter((play) => playMatchesSearch(play, query))
    .sort((left, right) => compareSearchResults(left, right, baskets));
}
