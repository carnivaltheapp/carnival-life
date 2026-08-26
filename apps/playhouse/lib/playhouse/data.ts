import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
} from "../../domain/play";
import { isIsoCalendarDate } from "../../domain/play-input";
import type { Database } from "../supabase/database.types";

export type CalendarViewKey = "date" | "today" | "tomorrow" | "week";

export type SelectedView =
  | {
      kind: "calendar";
      key: CalendarViewKey;
      label: string;
      startDate: string;
      endDate: string;
    }
  | {
      kind: "basket";
      basket: BasketSummary;
      label: string;
    };

export type PlayhouseData = {
  baskets: BasketSummary[];
  error: boolean;
  nextPlayOptions: NextPlayOption[];
  plays: PlayListItem[];
  selectedView: SelectedView;
};

export function dateInTimeZone(date: Date, timeZone: string) {
  let parts: Intl.DateTimeFormatPart[];

  try {
    parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
      year: "numeric",
    }).formatToParts(date);
  }
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function resolveSelectedView({
  basketSlug,
  baskets,
  date,
  now = new Date(),
  timeZone,
  view,
}: {
  basketSlug?: string;
  baskets: BasketSummary[];
  date?: string;
  now?: Date;
  timeZone: string;
  view?: string;
}): SelectedView {
  if (basketSlug) {
    const basket = baskets.find((item) => item.slug === basketSlug);
    if (basket) {
      return { basket, kind: "basket", label: basket.name };
    }
  }

  if (date && isIsoCalendarDate(date)) {
    return {
      endDate: date,
      key: "date",
      kind: "calendar",
      label: new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(new Date(`${date}T00:00:00Z`)),
      startDate: date,
    };
  }

  const today = dateInTimeZone(now, timeZone);
  const calendarView: CalendarViewKey =
    view === "tomorrow" || view === "week" ? view : "today";

  if (calendarView === "tomorrow") {
    const tomorrow = addDays(today, 1);
    return {
      endDate: tomorrow,
      key: calendarView,
      kind: "calendar",
      label: "Tomorrow",
      startDate: tomorrow,
    };
  }

  if (calendarView === "week") {
    return {
      endDate: addDays(today, 6),
      key: calendarView,
      kind: "calendar",
      label: "Next 7 days",
      startDate: today,
    };
  }

  return {
    endDate: today,
    key: calendarView,
    kind: "calendar",
    label: "Today",
    startDate: today,
  };
}

export async function loadPlayhouseData({
  basketSlug,
  date,
  supabase,
  timeZone,
  view,
}: {
  basketSlug?: string;
  date?: string;
  supabase: SupabaseClient<Database>;
  timeZone: string;
  view?: string;
}): Promise<PlayhouseData> {
  const { data: basketRows, error: basketError } = await supabase
    .from("baskets")
    .select("id, name, slug, sort_order")
    .order("sort_order", { ascending: true });

  const baskets: BasketSummary[] = (basketRows ?? []).map((basket) => ({
    id: basket.id,
    name: basket.name,
    slug: basket.slug,
    sortOrder: basket.sort_order,
  }));
  const selectedView = resolveSelectedView({ basketSlug, baskets, date, timeZone, view });

  if (basketError) {
    return {
      baskets: [],
      error: true,
      nextPlayOptions: [],
      plays: [],
      selectedView,
    };
  }

  let playQuery = supabase
    .from("plays")
    .select(
      "id, title, play_type, source_type, scheduled_date, basket_id, duration_minutes, player_contact_id, branch, note, url, push_rule, place, sort_order, created_at",
    )
    .eq("status", "open");

  if (selectedView.kind === "basket") {
    playQuery = playQuery.eq("basket_id", selectedView.basket.id);
  } else {
    playQuery = playQuery
      .gte("scheduled_date", selectedView.startDate)
      .lte("scheduled_date", selectedView.endDate);
  }

  const [
    { data: playRows, error: playError },
    { data: optionRows, error: optionError },
  ] = await Promise.all([
      playQuery
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("plays")
        .select("id, title, status, play_type, scheduled_date, basket_id")
        .order("title", { ascending: true })
        .limit(1000),
    ]);

  const playerContactIds = Array.from(
    new Set(
      (playRows ?? []).flatMap((play) =>
        play.player_contact_id ? [play.player_contact_id] : [],
      ),
    ),
  );
  const contactResult =
    playerContactIds.length > 0
      ? await supabase
          .from("contact_references")
          .select("id, display_name")
          .in("id", playerContactIds)
      : { data: [], error: null };
  const contactNameById = new Map(
    (contactResult.data ?? []).map((contact) => [contact.id, contact.display_name]),
  );

  const playIds = (playRows ?? []).map((play) => play.id);
  const relationshipResult =
    playIds.length > 0
      ? await supabase
          .from("play_relationships")
          .select("from_play_id, to_play_id")
          .in("from_play_id", playIds)
          .eq("relationship_type", "next")
      : { data: [], error: null };
  const nextByPlayId = new Map(
    (relationshipResult.data ?? []).map((relationship) => [
      relationship.from_play_id,
      relationship.to_play_id,
    ]),
  );

  const plays: PlayListItem[] = (playRows ?? []).map((play) => ({
    basketId: play.basket_id,
    branch: play.branch,
    durationMinutes: play.duration_minutes,
    id: play.id,
    note: play.note,
    nextPlayId: nextByPlayId.get(play.id) ?? null,
    place: play.place,
    playerContactId: play.player_contact_id,
    playerDisplayName: play.player_contact_id
      ? (contactNameById.get(play.player_contact_id) ?? null)
      : null,
    playType: play.play_type,
    pushRule: play.push_rule,
    scheduledDate: play.scheduled_date,
    sourceType: play.source_type,
    title: play.title,
    url: play.url,
  }));

  const nextPlayOptions: NextPlayOption[] = (optionRows ?? []).map((play) => ({
    basketId: play.basket_id,
    id: play.id,
    playType: play.play_type,
    scheduledDate: play.scheduled_date,
    status: play.status,
    title: play.title,
  }));

  return {
    baskets,
    error: Boolean(
      playError || optionError || contactResult.error || relationshipResult.error,
    ),
    nextPlayOptions,
    plays,
    selectedView,
  };
}
