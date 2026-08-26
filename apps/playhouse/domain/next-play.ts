import { isIsoCalendarDate, isUuid } from "./play-input";
import { PLAY_TYPES, type PlayPlacement, type PlayType } from "./play";

export type NextRelationshipEdge = {
  fromPlayId: string;
  toPlayId: string;
};

export type NextRelationshipValidation =
  | { status: "changed" | "removed" | "unchanged"; valid: true }
  | { message: string; valid: false };

export function validateNextRelationship({
  edges,
  fromPlayId,
  toPlayId,
}: {
  edges: NextRelationshipEdge[];
  fromPlayId: string;
  toPlayId: string | null;
}): NextRelationshipValidation {
  const existing = edges.find((edge) => edge.fromPlayId === fromPlayId);

  if (!toPlayId) {
    return { status: existing ? "removed" : "unchanged", valid: true };
  }
  if (fromPlayId === toPlayId) {
    return { message: "A Play cannot point to itself.", valid: false };
  }
  if (existing?.toPlayId === toPlayId) {
    return { status: "unchanged", valid: true };
  }

  const nextByPlay = new Map(
    edges
      .filter((edge) => edge.fromPlayId !== fromPlayId)
      .map((edge) => [edge.fromPlayId, edge.toPlayId]),
  );
  const visited = new Set<string>();
  let current: string | undefined = toPlayId;

  while (current) {
    if (current === fromPlayId) {
      return { message: "That relationship would create a cycle.", valid: false };
    }
    if (visited.has(current)) {
      return { message: "The selected Play is already part of a cycle.", valid: false };
    }
    visited.add(current);
    current = nextByPlay.get(current);
  }

  return { status: "changed", valid: true };
}

export type NewNextPlayInput = {
  placement: PlayPlacement;
  playType: PlayType;
  title: string;
};

export type NewNextPlayInputResult =
  | {
      errors: Partial<Record<"basketId" | "placement" | "playType" | "scheduledDate" | "title", string>>;
      success: false;
    }
  | { data: NewNextPlayInput; success: true };

function stringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function parseNewNextPlayInput(formData: FormData): NewNextPlayInputResult {
  const errors: Partial<
    Record<"basketId" | "placement" | "playType" | "scheduledDate" | "title", string>
  > = {};
  const title = stringValue(formData, "nextTitle");
  const placementKind = stringValue(formData, "nextPlacementKind");
  const scheduledDate = stringValue(formData, "nextScheduledDate");
  const basketId = stringValue(formData, "nextBasketId");
  const rawPlayType = stringValue(formData, "nextPlayType");

  if (!title) {
    errors.title = "Enter a title for the next Play.";
  } else if (title.length > 500) {
    errors.title = "Use 500 characters or fewer.";
  }

  const playType = PLAY_TYPES.includes(rawPlayType as PlayType)
    ? (rawPlayType as PlayType)
    : null;
  if (!playType) {
    errors.playType = "Choose Normal or Reminder.";
  }

  let placement: PlayPlacement | null = null;
  if (placementKind === "calendar") {
    if (!isIsoCalendarDate(scheduledDate)) {
      errors.scheduledDate = "Choose a valid calendar date.";
    }
    if (basketId) {
      errors.placement = "Choose either a date or a Basket, not both.";
    }
    if (!errors.scheduledDate && !errors.placement) {
      placement = { kind: "calendar", scheduledDate };
    }
  } else if (placementKind === "basket") {
    if (!isUuid(basketId)) {
      errors.basketId = "Choose a valid Basket.";
    }
    if (scheduledDate) {
      errors.placement = "Choose either a date or a Basket, not both.";
    }
    if (!errors.basketId && !errors.placement) {
      placement = { basketId, kind: "basket" };
    }
  } else {
    errors.placement = "Choose a calendar date or Basket.";
  }

  if (Object.keys(errors).length > 0 || !placement || !playType) {
    return { errors, success: false };
  }

  return { data: { placement, playType, title }, success: true };
}
