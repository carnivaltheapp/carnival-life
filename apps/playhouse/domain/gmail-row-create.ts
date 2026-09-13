import type { PlayInput } from "./play-input";
import { isIsoCalendarDate, isUuid } from "./play-input";
import type { PlayListItem, PlayPlacement } from "./play";
import {
  parseGmailAttachmentUrl,
  sanitizeGmailParticipants,
  type GmailAttachment,
  type GmailParticipants,
} from "./gmail-attachment";

export type GmailRowCreateRequest = {
  correlationId: string;
  gmailParticipants?: unknown;
  subject: string;
  targetPlayId: string;
  url: string;
};

export type ParsedGmailRowCreate = {
  attachment: GmailAttachment;
  correlationId: string;
  gmailParticipants: GmailParticipants | null;
  subject: string;
  targetPlayId: string;
};

export function claimGmailRowCreate(processed: Set<string>, correlationId: string) {
  if (processed.has(correlationId)) return false;
  processed.add(correlationId);
  return true;
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
  if (!attachment || !subject || subject.length > 500 || !correlationId ||
      correlationId.length > 100 || !targetPlayId || targetPlayId.length > 100) return null;

  return {
    attachment,
    correlationId,
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
