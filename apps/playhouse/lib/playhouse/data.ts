import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
} from "../../domain/play";
import { isIsoCalendarDate } from "../../domain/play-input";
import { comparePlayRankAndPriority, sortChronologicalPlays } from "../../domain/play-sort";
import { searchPlays } from "../../domain/play-search";
import type { Database } from "../supabase/database.types";
import { resolvePlayhouseDataSource } from "./data-source";
import { createPlayRepository } from "./play-repository";

export type CalendarViewKey = "date" | "today" | "tomorrow" | "week";

export type SelectedView =
  | {
      kind: "all";
      key: "all";
      label: string;
      defaultDate: string;
    }
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
  supportsWorkflows: boolean;
  searchQuery: string;
  todayDate: string;
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

export function sortPlaysForDisplay(plays: PlayListItem[]) {
  return [...plays].sort(comparePlayRankAndPriority);
}

export function sortPlaysForSelectedView(
  plays: PlayListItem[],
  selectedView: SelectedView,
) {
  return selectedView.kind === "all" ||
      (selectedView.kind === "calendar" && selectedView.key === "week")
    ? sortChronologicalPlays(plays)
    : sortPlaysForDisplay(plays);
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
  if (view === "all") {
    return {
      defaultDate: today,
      key: "all",
      kind: "all",
      label: "All Plays",
    };
  }
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
  ownerUserId,
  supabase,
  timeZone,
  view,
  searchQuery = "",
}: {
  basketSlug?: string;
  date?: string;
  ownerUserId: string;
  supabase: SupabaseClient<Database>;
  timeZone: string;
  view?: string;
  searchQuery?: string;
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
  const now = new Date();
  const selectedView = resolveSelectedView({ basketSlug, baskets, date, now, timeZone, view });
  const todayDate = dateInTimeZone(now, timeZone);

  if (basketError) {
    return {
      baskets: [],
      error: true,
      nextPlayOptions: [],
      plays: [],
      selectedView,
      supportsWorkflows: false,
      searchQuery,
      todayDate,
    };
  }

  try {
    const repository = await createPlayRepository({
      baskets,
      ownerUserId,
      source: resolvePlayhouseDataSource(),
      supabase,
    });
    if (!(await repository.reconcileDueReminders(todayDate))) {
      throw new Error("Due Reminders could not be reconciled.");
    }
    const result = await repository.list(searchQuery ? undefined : selectedView);
    return {
      baskets,
      error: result.error,
      nextPlayOptions: result.nextPlayOptions,
      plays: searchQuery
        ? searchPlays(result.plays, searchQuery, baskets)
        : sortPlaysForSelectedView(result.plays, selectedView),
      searchQuery,
      selectedView,
      supportsWorkflows: repository.supportsWorkflows,
      todayDate,
    };
  } catch {
    return {
      baskets,
      error: true,
      nextPlayOptions: [],
      plays: [],
      selectedView,
      supportsWorkflows: false,
      searchQuery,
      todayDate,
    };
  }
}
