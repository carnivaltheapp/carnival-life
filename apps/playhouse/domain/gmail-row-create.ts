import type { PlayInput } from "./play-input";
import { isIsoCalendarDate, isUuid } from "./play-input";
import type { BasketSummary, PlayListItem, PlayPlacement } from "./play";
import {
  parseGmailAttachmentUrl,
  sanitizeGmailApiThreadId,
  sanitizeGmailParticipants,
  type GmailAttachment,
  type GmailParticipants,
} from "./gmail-attachment";
import { searchPlays } from "./play-search";
import { compareChronologicalPlays, comparePlayRankAndPriority } from "./play-sort";

type GmailRowCreateView =
  | { kind: "all"; defaultDate: string }
  | { kind: "basket"; basket: { id: string } }
  | {
      kind: "calendar";
      endDate: string;
      key: "date" | "today" | "tomorrow" | "week";
      startDate: string;
    };

export type GmailRowCreateRequest = {
  correlationId: string;
  gmailApiThreadId?: unknown;
  gmailApiThreadStrategy?: unknown;
  gmailDragSource?: unknown;
  gmailParticipants?: unknown;
  subject: string;
  targetPlayId: string;
  url: string;
};

export type ParsedGmailRowCreate = {
  attachment: GmailAttachment;
  correlationId: string;
  gmailApiThreadStrategy: "ancestor" | "conversation_header" | "direct" | "missing";
  gmailDragSource: "list_row" | "opened_conversation";
  gmailParticipants: GmailParticipants | null;
  subject: string;
  targetPlayId: string;
};

export function claimGmailRowCreate(processed: Set<string>, correlationId: string) {
  if (processed.has(correlationId)) return false;
  processed.add(correlationId);
  return true;
}

export function mergeCreatedGmailPlay({
  baskets,
  createdPlay,
  plays,
  searchQuery,
  selectedView,
}: {
  baskets: BasketSummary[];
  createdPlay: PlayListItem;
  plays: PlayListItem[];
  searchQuery: string;
  selectedView: GmailRowCreateView;
}) {
  const merged = [...plays.filter(({ id }) => id !== createdPlay.id), createdPlay];
  if (searchQuery) return searchPlays(merged, searchQuery, baskets);

  const belongsToView = selectedView.kind === "basket"
    ? createdPlay.basketId === selectedView.basket.id
    : selectedView.kind === "all"
      ? !createdPlay.basketId && Boolean(
        createdPlay.scheduledDate &&
        createdPlay.scheduledDate >= selectedView.defaultDate &&
        createdPlay.scheduledDate < "2200-01-01",
      )
      : !createdPlay.basketId && Boolean(
        createdPlay.scheduledDate &&
        createdPlay.scheduledDate >= selectedView.startDate &&
        createdPlay.scheduledDate <= selectedView.endDate,
      );
  if (!belongsToView) return plays;

  return merged.sort(
    selectedView.kind === "all" ||
      (selectedView.kind === "calendar" && selectedView.key === "week")
      ? compareChronologicalPlays
      : comparePlayRankAndPriority,
  );
}

export function parseGmailRowCreateRequest(value: unknown): ParsedGmailRowCreate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Partial<GmailRowCreateRequest>;
  const subject = typeof request.subject === "string" ? request.subject.trim() : "";
  const correlationId = typeof request.correlationId === "string"
    ? request.correlationId.trim()
    : "";
  const targetPlayId = typeof request.targetPlayId === "string"
    ? request.targetPlayId.trim()
    : "";
  const attachment = typeof request.url === "string"
    ? parseGmailAttachmentUrl(request.url)
    : null;
  const apiThreadId = sanitizeGmailApiThreadId(request.gmailApiThreadId);
  const gmailApiThreadStrategy = ["ancestor", "conversation_header", "direct"].includes(
    String(request.gmailApiThreadStrategy),
  )
    ? request.gmailApiThreadStrategy as "ancestor" | "conversation_header" | "direct"
    : "missing";
  const gmailDragSource = request.gmailDragSource === "list_row"
    ? "list_row"
    : "opened_conversation";
  if (!attachment || !subject || subject.length > 500 || !correlationId ||
      correlationId.length > 100 || !targetPlayId || targetPlayId.length > 100) return null;

  return {
    attachment: {
      ...attachment,
      ...(apiThreadId ? { apiThreadId } : {}),
    },
    correlationId,
    gmailApiThreadStrategy,
    gmailDragSource,
    gmailParticipants: sanitizeGmailParticipants(request.gmailParticipants),
    subject,
    targetPlayId,
  };
}

function targetPlacement(target: PlayListItem): PlayPlacement | null {
  if (target.basketId && !target.scheduledDate && isUuid(target.basketId)) {
    return { basketId: target.basketId, kind: "basket" };
  }
  if (!target.basketId && target.scheduledDate && isIsoCalendarDate(target.scheduledDate)) {
    return { kind: "calendar", scheduledDate: target.scheduledDate };
  }
  return null;
}

export function gmailRowCreateInput(
  parsed: ParsedGmailRowCreate,
  target: PlayListItem,
): PlayInput | null {
  const placement = targetPlacement(target);
  if (!placement || target.legacyTaskType === "A") return null;
  return {
    branch: null,
    durationMinutes: 30,
    note: null,
    place: "Office",
    placement,
    playType: target.playType,
    playerContactId: null,
    pushRule: "everyday",
    title: parsed.subject,
    url: null,
  };
}
