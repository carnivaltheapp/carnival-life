import type { BasketSummary } from "./play";

export type CalendarViewKey = "date" | "today" | "tomorrow" | "week";
export type PlayLifecycle = "active" | "done" | "trash";

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

export function resolvePlayLifecycle(value?: string): PlayLifecycle {
  return value === "done" || value === "trash" ? value : "active";
}

/** Done and Trash filter lifecycle without changing the current PlayHouse scope. */
export function lifecycleViewHref({
  lifecycle,
  searchQuery,
  selectedView,
}: {
  lifecycle: PlayLifecycle;
  searchQuery: string;
  selectedView: SelectedView;
}) {
  const params = new URLSearchParams();
  if (selectedView.kind === "basket") params.set("basket", selectedView.basket.slug);
  else if (selectedView.kind === "all") params.set("view", "all");
  else if (selectedView.key === "date") params.set("date", selectedView.startDate);
  else params.set("view", selectedView.key);
  if (searchQuery) params.set("q", searchQuery);
  if (lifecycle !== "active") params.set("lifecycle", lifecycle);
  return `/?${params.toString()}`;
}

export function retainLifecycleInHref(href: string, lifecycle: PlayLifecycle) {
  if (lifecycle === "active") return href;
  const [path, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("lifecycle", lifecycle);
  return `${path}?${params.toString()}`;
}
