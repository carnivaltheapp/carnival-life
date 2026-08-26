export const PLAY_STATUSES = ["open", "done", "trash"] as const;
export const PLAY_TYPES = ["normal", "reminder"] as const;
export const PLAY_SOURCE_TYPES = ["user", "gmail"] as const;
export const PUSH_RULES = ["everyday", "weekdays", "weekends"] as const;

export type PlayStatus = (typeof PLAY_STATUSES)[number];
export type PlayType = (typeof PLAY_TYPES)[number];
export type PlaySourceType = (typeof PLAY_SOURCE_TYPES)[number];
export type PushRule = (typeof PUSH_RULES)[number];

export type PlayPlacement =
  | { kind: "calendar"; scheduledDate: string }
  | { kind: "basket"; basketId: string };

export interface Play {
  id: string;
  ownerUserId: string;
  title: string;
  status: PlayStatus;
  playType: PlayType;
  sourceType: PlaySourceType;
  placement: PlayPlacement;
  durationMinutes: number | null;
  playerContactId: string | null;
  branch: string | null;
  note: string | null;
  url: string | null;
  pushRule: PushRule;
  place: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface BasketSummary {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
}

export interface PlayListItem {
  branch: string | null;
  durationMinutes: number | null;
  id: string;
  place: string | null;
  playType: PlayType;
  sourceType: PlaySourceType;
  title: string;
}
