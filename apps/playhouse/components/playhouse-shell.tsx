import Link from "next/link";

import {
  DEFAULT_BASKETS,
  isDefaultBasketSlug,
  type DefaultBasketSlug,
} from "../domain/play";

type View =
  | { kind: "calendar"; key: "today" | "tomorrow" | "week"; label: string }
  | { kind: "basket"; key: DefaultBasketSlug; label: string };

const CALENDAR_VIEWS = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "Next 7 days" },
] as const;

function resolveView(view: string | undefined, basket: string | undefined): View {
  if (basket && isDefaultBasketSlug(basket)) {
    const definition = DEFAULT_BASKETS.find((item) => item.slug === basket);
    return { kind: "basket", key: basket, label: definition?.name ?? "Basket" };
  }

  const calendarView = CALENDAR_VIEWS.find((item) => item.key === view);
  return {
    kind: "calendar",
    key: calendarView?.key ?? "today",
    label: calendarView?.label ?? "Today",
  };
}

export function PlayhouseShell({
  view,
  basket,
}: {
  view?: string;
  basket?: string;
}) {
  const selectedView = resolveView(view, basket);

  return (
    <main className="workspace">
      <header className="appHeader">
        <Link className="brand" href="/?view=today" aria-label="Carnival PlayHouse home">
          <span className="brandMark" aria-hidden="true">
            C
          </span>
          <span>
            <strong>Carnival</strong>
            <small>PlayHouse</small>
          </span>
        </Link>

        <div className="headerStatus" aria-label="Application status">
          <span className="statusDot" aria-hidden="true" />
          Phase 1 foundation
        </div>
      </header>

      <div className="workspaceBody">
        <aside className="sidebar" aria-label="Play destinations">
          <nav className="destinationNav">
            <section aria-labelledby="calendar-heading">
              <h2 id="calendar-heading">Calendar</h2>
              <div className="navItems">
                {CALENDAR_VIEWS.map((item) => {
                  const isActive =
                    selectedView.kind === "calendar" && selectedView.key === item.key;

                  return (
                    <Link
                      className="destinationLink"
                      data-active={isActive || undefined}
                      href={`/?view=${item.key}`}
                      key={item.key}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span className="destinationIcon" aria-hidden="true">
                        {item.key === "today" ? "●" : item.key === "tomorrow" ? "○" : "•••"}
                      </span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="baskets-heading">
              <h2 id="baskets-heading">Baskets</h2>
              <div className="navItems">
                {DEFAULT_BASKETS.map((item) => {
                  const isActive =
                    selectedView.kind === "basket" && selectedView.key === item.slug;

                  return (
                    <Link
                      className="destinationLink"
                      data-active={isActive || undefined}
                      href={`/?basket=${item.slug}`}
                      key={item.slug}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span className="destinationIcon basketIcon" aria-hidden="true">
                        ◇
                      </span>
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </section>
          </nav>
        </aside>

        <section className="playPanel" aria-labelledby="view-title">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">
                {selectedView.kind === "calendar" ? "Calendar" : "Basket"}
              </p>
              <h1 id="view-title">{selectedView.label}</h1>
            </div>
            <span className="countBadge" aria-label="Zero open Plays">
              0 Plays
            </span>
          </div>

          <div className="emptyState">
            <span className="spark" aria-hidden="true">
              ✦
            </span>
            <h2>The stage is ready.</h2>
            <p>
              Play storage, ownership, Baskets, relationships, settings, and event history
              now have a version-controlled database foundation. Authentication and live Play
              data arrive in the next Phase 1 slice.
            </p>
            <div className="foundationChecklist" aria-label="Foundation status">
              <span>Schema defined</span>
              <span>RLS enabled</span>
              <span>History ready</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
