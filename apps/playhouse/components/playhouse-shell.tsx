import Link from "next/link";

import { signOut } from "../app/auth/actions";
import type { BasketSummary, PlayListItem } from "../domain/play";
import type { SelectedView } from "../lib/playhouse/data";

const CALENDAR_VIEWS = [
  { key: "today", label: "Today", marker: "●" },
  { key: "tomorrow", label: "Tomorrow", marker: "○" },
  { key: "week", label: "Next 7 days", marker: "•••" },
] as const;

export type UserIdentity = {
  displayName: string;
  email: string | null;
};

function playMeta(play: PlayListItem) {
  return [
    play.playType === "reminder" ? "Reminder" : "Normal",
    play.sourceType === "gmail" ? "Email" : null,
    play.durationMinutes ? `${play.durationMinutes} min` : null,
    play.branch,
    play.place,
  ].filter(Boolean);
}

export function PlayhouseShell({
  baskets,
  dataError,
  identity,
  plays,
  selectedView,
}: {
  baskets: BasketSummary[];
  dataError: boolean;
  identity: UserIdentity;
  plays: PlayListItem[];
  selectedView: SelectedView;
}) {
  const playCountLabel = `${plays.length} ${plays.length === 1 ? "Play" : "Plays"}`;

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

        <div className="accountArea">
          <div className="accountIdentity">
            <span className="accountAvatar" aria-hidden="true">
              {identity.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="accountText">
              <strong>{identity.displayName}</strong>
              {identity.email ? <small>{identity.email}</small> : null}
            </span>
          </div>
          <form action={signOut}>
            <button className="signOutButton" type="submit">
              Sign out
            </button>
          </form>
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
                      aria-current={isActive ? "page" : undefined}
                      className="destinationLink"
                      data-active={isActive || undefined}
                      href={`/?view=${item.key}`}
                      key={item.key}
                    >
                      <span className="destinationIcon" aria-hidden="true">
                        {item.marker}
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
                {baskets.map((basket) => {
                  const isActive =
                    selectedView.kind === "basket" &&
                    selectedView.basket.id === basket.id;

                  return (
                    <Link
                      aria-current={isActive ? "page" : undefined}
                      className="destinationLink"
                      data-active={isActive || undefined}
                      href={`/?basket=${encodeURIComponent(basket.slug)}`}
                      key={basket.id}
                    >
                      <span className="destinationIcon basketIcon" aria-hidden="true">
                        ◇
                      </span>
                      {basket.name}
                    </Link>
                  );
                })}
                {!dataError && baskets.length === 0 ? (
                  <p className="navEmpty">No Baskets available</p>
                ) : null}
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
            <span className="countBadge" aria-label={`${playCountLabel} open`}>
              {playCountLabel}
            </span>
          </div>

          {dataError ? (
            <div className="emptyState" role="alert">
              <span className="spark errorSpark" aria-hidden="true">
                !
              </span>
              <h2>PlayHouse could not load.</h2>
              <p>
                Your session is still secure. Refresh the page in a moment, or sign out and
                try again.
              </p>
            </div>
          ) : plays.length === 0 ? (
            <div className="emptyState">
              <span className="spark" aria-hidden="true">
                ✦
              </span>
              <h2>No Plays here yet.</h2>
              <p>
                This view is connected to Carnival and ready for Plays. Creating and editing
                Plays comes in the next Phase 1 slice.
              </p>
            </div>
          ) : (
            <ol className="playList" aria-label={`Open Plays in ${selectedView.label}`}>
              {plays.map((play) => {
                const metadata = playMeta(play);
                return (
                  <li className="playRow" key={play.id}>
                    <span
                      className={`playTypeMarker playTypeMarker--${play.playType}`}
                      aria-label={play.playType === "reminder" ? "Reminder" : "Normal Play"}
                    />
                    <span className="playCopy">
                      <strong>{play.title}</strong>
                      {metadata.length > 0 ? <small>{metadata.join(" · ")}</small> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
