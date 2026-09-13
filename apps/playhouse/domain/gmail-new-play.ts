import type { PlayPlacement } from "./play";
import type { PlayInput } from "./play-input";
import { isIsoCalendarDate, isUuid } from "./play-input";
import {
  parseGmailAttachmentUrl,
  sanitizeGmailParticipants,
  type GmailAttachment,
  type GmailParticipants,
} from "./gmail-attachment";

export type GmailNewPlayRequest = {
  correlationId: string;
  gmailParticipants?: unknown;
  placement: PlayPlacement;
  subject: string;
  url: string;
};

export type ParsedGmailNewPlay = {
  attachment: GmailAttachment;
  correlationId: string;
  gmailParticipants: GmailParticipants | null;
  input: PlayInput;
};

export function claimGmailNewPlayDrop(processed: Set<string>, correlationId: string) {
  if (processed.has(correlationId)) return false;
  processed.add(correlationId);
  return true;
}

export function parseGmailNewPlayRequest(value: unknown): ParsedGmailNewPlay | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Partial<GmailNewPlayRequest>;
  const subject = typeof request.subject === "string" ? request.subject.trim() : "";
  const correlationId = typeof request.correlationId === "string"
    ? request.correlationId.trim()
    : "";
  const attachment = typeof request.url === "string"
    ? parseGmailAttachmentUrl(request.url)
    : null;
  const placement = request.placement;
  const validPlacement = placement?.kind === "calendar"
    ? isIsoCalendarDate(placement.scheduledDate)
    : placement?.kind === "basket"
      ? isUuid(placement.basketId)
      : false;
  if (!attachment || !subject || subject.length > 500 || !correlationId ||
      correlationId.length > 100 || !validPlacement) return null;

  return {
    attachment,
    correlationId,
    gmailParticipants: sanitizeGmailParticipants(request.gmailParticipants),
    input: {
      branch: null,
      durationMinutes: 30,
      note: null,
      place: "Office",
      placement: placement as PlayPlacement,
      playType: "normal",
      playerContactId: null,
      pushRule: "everyday",
      title: subject,
      url: null,
    },
  };
}
