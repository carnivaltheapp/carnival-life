import { ObjectId, type Filter, type WithId } from "mongodb";

import type {
  BasketSummary,
  PlayListItem,
  PlaySourceType,
  PlayType,
  PushRule,
} from "../../domain/play";
import type { PlayInput } from "../../domain/play-input";
import { LEGACY_BASKETS } from "../../migration/legacy/mapping";

export const MONGO_CARNIVAL_USER_ID =
  "096a5ba0-f3ac-469e-bb20-34c75cff2803";
export const MONGO_LEGACY_USER_ID = 43;

export type LegacyTaskDocument = Record<string, unknown> & {
  _id?: ObjectId;
  action_type?: unknown;
  branch?: unknown;
  contact_id?: unknown;
  created_date?: unknown;
  duration?: unknown;
  email?: unknown;
  first?: unknown;
  is_active?: unknown;
  is_deleted?: unknown;
  last?: unknown;
  note?: unknown;
  place?: unknown;
  priority_index?: unknown;
  push_type?: unknown;
  regarding?: unknown;
  task_date?: unknown;
  task_type?: unknown;
  thread_id?: unknown;
  updated_date?: unknown;
  url?: unknown;
  user_id?: unknown;
};

const basketDayBySlug = new Map<string, string>(
  Object.entries(LEGACY_BASKETS).map(([day, basket]) => [basket.slug, day]),
);
const basketSlugByDay = new Map<string, string>(
  Object.entries(LEGACY_BASKETS).map(([day, basket]) => [day, basket.slug]),
);

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result || null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function assertMongoUserMapping(ownerUserId: string) {
  if (ownerUserId !== MONGO_CARNIVAL_USER_ID) {
    throw new Error("This Carnival account is not mapped to the legacy Play store.");
  }
}

export function mongoPlayType(taskType: unknown): PlayType {
  return taskType === "S" ? "reminder" : "normal";
}

export function mongoPushRule(pushType: unknown): PushRule {
  if (pushType === "Weekday" || pushType === "Weekdays") return "weekdays";
  if (pushType === "Weekend" || pushType === "Weekends") return "weekends";
  return "everyday";
}

export function legacyPushType(pushRule: PushRule) {
  if (pushRule === "weekdays") return "Weekday";
  if (pushRule === "weekends") return "Weekend";
  return "Everyday";
}

export function legacyTaskTypeForSave(existingTaskType: unknown, playType: PlayType) {
  if (playType === "reminder") {
    return existingTaskType === "S" ? undefined : "S";
  }
  return existingTaskType === "S" ? "H" : undefined;
}

export function mongoActiveFilter(): Filter<LegacyTaskDocument> {
  return {
    is_active: true,
    is_deleted: false,
    user_id: MONGO_LEGACY_USER_ID,
  };
}

function utcDayRange(startDate: string, endDate = startDate) {
  const endExclusive = new Date(`${endDate}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return {
    $gte: new Date(`${startDate}T00:00:00.000Z`),
    $lt: endExclusive,
  };
}

export function mongoDateFilter(startDate: string, endDate = startDate) {
  return {
    ...mongoActiveFilter(),
    task_date: utcDayRange(startDate, endDate),
  } satisfies Filter<LegacyTaskDocument>;
}

export function mongoBasketFilter(basketSlug: string) {
  const day = basketDayBySlug.get(basketSlug);
  if (!day) {
    throw new Error("That Basket does not have a documented Mongo mapping.");
  }
  return {
    ...mongoActiveFilter(),
    task_date: utcDayRange(day),
  } satisfies Filter<LegacyTaskDocument>;
}

export function mongoMutationFilter(playId: string): Filter<LegacyTaskDocument> {
  if (!ObjectId.isValid(playId)) {
    throw new Error("Invalid Mongo Play identifier.");
  }
  return {
    _id: new ObjectId(playId),
    user_id: MONGO_LEGACY_USER_ID,
  };
}

export function legacyTaskDate(input: PlayInput, baskets: BasketSummary[]) {
  if (input.placement.kind === "calendar") {
    return new Date(`${input.placement.scheduledDate}T00:00:00.000Z`);
  }
  const basketId = input.placement.kind === "basket" ? input.placement.basketId : "";
  const basket = baskets.find((candidate) => candidate.id === basketId);
  const day = basket ? basketDayBySlug.get(basket.slug) : undefined;
  if (!day) {
    throw new Error("That Basket does not have a documented Mongo mapping.");
  }
  return new Date(`${day}T00:00:00.000Z`);
}

export function mongoEditableSet({
  baskets,
  existingTaskType,
  input,
  playerResourceName,
}: {
  baskets: BasketSummary[];
  existingTaskType: unknown;
  input: PlayInput;
  playerResourceName: string | null;
}) {
  const values: Record<string, unknown> = {
    action_type: input.title,
    branch: input.branch ?? "",
    contact_id: playerResourceName ?? "",
    note: input.note ?? "",
    place: input.place ?? "",
    push_type: legacyPushType(input.pushRule),
    task_date: legacyTaskDate(input, baskets),
    updated_date: new Date(),
    url: input.url ?? "",
  };
  if (input.playType === "normal") values.duration = input.durationMinutes;
  const taskType = legacyTaskTypeForSave(existingTaskType, input.playType);
  if (taskType) values.task_type = taskType;
  return values;
}

export function mongoCreateDocument({
  baskets,
  input,
  playerResourceName,
  priorityIndex,
  now = new Date(),
}: {
  baskets: BasketSummary[];
  input: PlayInput;
  playerResourceName: string | null;
  priorityIndex: string;
  now?: Date;
}): LegacyTaskDocument {
  return {
    action_type: input.title,
    amount: "",
    branch: input.branch ?? "",
    category_id: "",
    contact_id: playerResourceName ?? "",
    created_date: now,
    duration: input.durationMinutes,
    email: "",
    etype: "",
    event_id: "",
    first: "",
    g_address: "",
    is_active: true,
    is_deleted: false,
    is_pushed: false,
    last: "",
    last_id: "",
    long_id: "",
    message_id: "",
    note: input.note ?? "",
    old_task_id: "",
    phone: "",
    place: input.place ?? "",
    priority_index: priorityIndex,
    ptype: "",
    push_type: legacyPushType(input.pushRule),
    regarding: "user",
    task_date: legacyTaskDate(input, baskets),
    task_status: "",
    task_time: "",
    task_type: input.playType === "reminder" ? "S" : "H",
    thread_id: "",
    time_task: false,
    updated_date: now,
    url: input.url ?? "",
    user_id: MONGO_LEGACY_USER_ID,
  };
}

export function nextLegacyPriorityIndex(existing: unknown) {
  const match = typeof existing === "string" ? /^(\d{2})-([0-9A-Fa-f]{8})$/.exec(existing) : null;
  if (!match) return "10-00000128";
  const next = Math.min(Number.parseInt(match[2], 16) + 0x100, 0xffffffff);
  return `${match[1]}-${next.toString(16).toUpperCase().padStart(8, "0")}`;
}

export type MongoContactDisplay = {
  displayName: string;
  id: string;
};

export function mongoContactResourceName(task: LegacyTaskDocument) {
  return text(task.contact_id);
}

export function mongoContactFallback(task: LegacyTaskDocument) {
  return [text(task.first), text(task.last)].filter(Boolean).join(" ") ||
    text(task.email) ||
    "Selected Player";
}

export function mapMongoPlay(
  task: WithId<LegacyTaskDocument>,
  baskets: BasketSummary[],
  contact?: MongoContactDisplay,
): PlayListItem {
  const taskDay = task.task_date instanceof Date
    ? task.task_date.toISOString().slice(0, 10)
    : null;
  const basketSlug = taskDay ? basketSlugByDay.get(taskDay) : undefined;
  const basket = basketSlug
    ? baskets.find((candidate) => candidate.slug === basketSlug)
    : undefined;
  const sourceType: PlaySourceType = task.regarding === "email" ? "gmail" : "user";
  const resourceName = mongoContactResourceName(task);

  return {
    basketId: basket?.id ?? null,
    branch: text(task.branch),
    durationMinutes: number(task.duration),
    gmailThreadId: text(task.thread_id),
    id: task._id.toHexString(),
    note: text(task.note),
    nextPlayId: null,
    place: text(task.place),
    playerContactId: contact?.id ?? null,
    playerDisplayName: resourceName
      ? (contact?.displayName ?? mongoContactFallback(task))
      : null,
    playType: mongoPlayType(task.task_type),
    pushRule: mongoPushRule(task.push_type),
    scheduledDate: basket ? null : taskDay,
    sourceMetadata: null,
    sourceType,
    title: text(task.action_type) ?? "Untitled Play",
    url: text(task.url),
  };
}
