import { PLAY_TYPES, PUSH_RULES, type PlayPlacement, type PlayType, type PushRule } from "./play";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type PlayInput = {
  branch: string | null;
  durationMinutes: number | null;
  note: string | null;
  place: string | null;
  placement: PlayPlacement;
  playType: PlayType;
  pushRule: PushRule;
  title: string;
  url: string | null;
};

export type PlayInputField =
  | "basketId"
  | "branch"
  | "durationMinutes"
  | "note"
  | "place"
  | "placement"
  | "playType"
  | "pushRule"
  | "scheduledDate"
  | "title"
  | "url";

export type PlayInputResult =
  | { errors: Partial<Record<PlayInputField, string>>; success: false }
  | { data: PlayInput; success: true };

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function optionalText(
  formData: FormData,
  key: PlayInputField,
  maxLength: number,
  errors: Partial<Record<PlayInputField, string>>,
) {
  const text = value(formData, key);
  if (text.length > maxLength) {
    errors[key] = `Use ${maxLength.toLocaleString()} characters or fewer.`;
  }
  return text || null;
}

export function isUuid(valueToCheck: string) {
  return UUID_PATTERN.test(valueToCheck);
}

export function isIsoCalendarDate(valueToCheck: string) {
  if (!DATE_PATTERN.test(valueToCheck)) {
    return false;
  }

  const [year, month, day] = valueToCheck.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parsePlayInput(formData: FormData): PlayInputResult {
  const errors: Partial<Record<PlayInputField, string>> = {};
  const title = value(formData, "title");
  const placementKind = value(formData, "placementKind");
  const scheduledDate = value(formData, "scheduledDate");
  const basketId = value(formData, "basketId");
  const rawPlayType = value(formData, "playType");
  const rawPushRule = value(formData, "pushRule");

  if (!title) {
    errors.title = "Enter a title.";
  } else if (title.length > 500) {
    errors.title = "Use 500 characters or fewer.";
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

  const playType = PLAY_TYPES.includes(rawPlayType as PlayType)
    ? (rawPlayType as PlayType)
    : null;
  if (!playType) {
    errors.playType = "Choose Normal or Reminder.";
  }

  const pushRule = PUSH_RULES.includes(rawPushRule as PushRule)
    ? (rawPushRule as PushRule)
    : null;
  if (!pushRule) {
    errors.pushRule = "Choose a valid Push rule.";
  }

  let durationMinutes: number | null = null;
  const duration = value(formData, "durationMinutes");
  if (playType === "normal" && duration) {
    const parsedDuration = Number(duration);
    if (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 1440) {
      errors.durationMinutes = "Enter whole minutes from 1 to 1,440.";
    } else {
      durationMinutes = parsedDuration;
    }
  }

  const branch = optionalText(formData, "branch", 200, errors);
  const note = optionalText(formData, "note", 10000, errors);
  const place = optionalText(formData, "place", 200, errors);
  const url = optionalText(formData, "url", 2048, errors);
  if (url) {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        errors.url = "Use a complete http:// or https:// URL.";
      }
    } catch {
      errors.url = "Use a complete http:// or https:// URL.";
    }
  }

  if (Object.keys(errors).length > 0 || !placement || !playType || !pushRule) {
    return { errors, success: false };
  }

  return {
    data: {
      branch,
      durationMinutes,
      note,
      place,
      placement,
      playType,
      pushRule,
      title,
      url,
    },
    success: true,
  };
}
