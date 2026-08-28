import type { BasketSummary, PlayListItem } from "./play";

const GOOGLE_DRIVE_BRANCH_PREFIX = "C:\\Google Drive\\";
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

export function displayBranch(branch: string | null) {
  return branch?.startsWith(GOOGLE_DRIVE_BRANCH_PREFIX)
    ? branch.slice(GOOGLE_DRIVE_BRANCH_PREFIX.length)
    : branch;
}

function objectValue(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonblankString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function gmailThreadIdFromMetadata(sourceMetadata: unknown) {
  const metadata = objectValue(sourceMetadata);
  if (!metadata) return null;
  return nonblankString(objectValue(metadata.external_ids)?.thread_id) ??
    nonblankString(objectValue(metadata.legacy_source)?.thread_id);
}

export function gmailThreadUrl(threadId: string) {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}

export function displayPlayDestination(
  play: Pick<PlayListItem, "basketId" | "scheduledDate">,
  baskets: BasketSummary[],
) {
  if (play.basketId) {
    return baskets.find((basket) => basket.id === play.basketId)?.name ?? "Basket";
  }
  if (!play.scheduledDate) return "—";
  const [year, month, day] = play.scheduledDate.split("-").map(Number);
  if (year >= 2200) return "Unknown Basket";
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday}-${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

export function playRowLeadingLabel(
  play: Pick<PlayListItem, "basketId" | "playerDisplayName" | "scheduledDate">,
  baskets: BasketSummary[],
  showDestination: boolean,
) {
  return showDestination
    ? displayPlayDestination(play, baskets)
    : (play.playerDisplayName ?? "");
}

export function usesDateLeadingColumn(view: { kind: string; key?: string }) {
  return view.kind === "all" || (view.kind === "calendar" && view.key === "week");
}
