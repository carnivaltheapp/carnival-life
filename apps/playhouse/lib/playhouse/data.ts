import type { SupabaseClient } from "@supabase/supabase-js";

import type { BasketSummary, PlayListItem } from "../../domain/play";
import type { Database } from "../supabase/database.types";

export type CalendarViewKey = "today" | "tomorrow" | "week";

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
  now = new Date(),
  timeZone,
  view,
}: {
  basketSlug?: string;
  baskets: BasketSummary[];
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
  supabase,
  timeZone,
  view,
}: {
  basketSlug?: string;
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
  const selectedView = resolveSelectedView({ basketSlug, baskets, timeZone, view });

  if (basketError) {
    return { baskets: [], error: true, plays: [], selectedView };
  }

  let playQuery = supabase
    .from("plays")
    .select(
      "id, title, play_type, source_type, duration_minutes, branch, place, sort_order, created_at",
    )
    .eq("status", "open");

  if (selectedView.kind === "basket") {
    playQuery = playQuery.eq("basket_id", selectedView.basket.id);
  } else {
    playQuery = playQuery
      .gte("scheduled_date", selectedView.startDate)
      .lte("scheduled_date", selectedView.endDate);
  }

  const { data: playRows, error: playError } = await playQuery
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const plays: PlayListItem[] = (playRows ?? []).map((play) => ({
    branch: play.branch,
    durationMinutes: play.duration_minutes,
    id: play.id,
    place: play.place,
    playType: play.play_type,
    sourceType: play.source_type,
    title: play.title,
  }));

  return {
    baskets,
    error: Boolean(playError),
    plays,
    selectedView,
  };
}
