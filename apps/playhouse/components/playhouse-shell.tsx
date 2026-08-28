import Link from "next/link";

import { signOut } from "../app/auth/actions";
import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
} from "../domain/play";
import type { SelectedView } from "../lib/playhouse/data";
import { displayBranch, playRowLeadingLabel } from "../domain/play-display";
import { CALENDAR_VIEWS } from "../domain/playhouse-navigation";
import { BrowserTimeZone } from "./browser-time-zone";
import { PlayForm } from "./play-form";
import { PlayStatusActions } from "./play-status-actions";

export type UserIdentity = {
  displayName: string;
  email: string | null;
};

export function PlayhouseShell({
  baskets,
  dataError,
  identity,
  nextPlayOptions,
  plays,
  selectedView,
  supportsWorkflows,
}: {
  baskets: BasketSummary[];
  dataError: boolean;
  identity: UserIdentity;
  nextPlayOptions: NextPlayOption[];
  plays: PlayListItem[];
  selectedView: SelectedView;
  supportsWorkflows: boolean;
}) {
  const playCountLabel = `${plays.length} ${plays.length === 1 ? "Play" : "Plays"}`;
  const defaultPlacement =
    selectedView.kind === "basket"
      ? { basketId: selectedView.basket.id, kind: "basket" as const }
      : {
          kind: "calendar" as const,
          scheduledDate: selectedView.kind === "all"
            ? selectedView.defaultDate
            : selectedView.startDate,
        };

  return (
    <main className="workspace">
      <BrowserTimeZone />
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
                    (selectedView.kind === "calendar" || selectedView.kind === "all") &&
                    selectedView.key === item.key;

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
                {selectedView.kind === "calendar"
                  ? "Calendar"
                  : selectedView.kind === "basket"
                    ? "Basket"
                    : "Plays"}
              </p>
              <h1 id="view-title">{selectedView.label}</h1>
            </div>
            <div className="panelActions">
              <span
                className="countBadge"
                data-testid="play-count"
                aria-label={`${playCountLabel} open`}
              >
                {playCountLabel}
              </span>
              {!dataError ? (
                <PlayForm
                  baskets={baskets}
                  defaultPlacement={defaultPlacement}
                  nextPlayOptions={nextPlayOptions}
                  supportsWorkflows={supportsWorkflows}
                />
              ) : null}
            </div>
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
                Create a Play here, or choose another calendar date or Basket.
              </p>
            </div>
          ) : (
            <ol className="playList" aria-label={`Open Plays in ${selectedView.label}`}>
              {plays.map((play) => (
                <li className="playRow" data-testid="play-row" key={play.id}>
                  <div className="playRowLine">
                    <div className="playIdentityCell">
                      <span
                        className={`playTypeMarker playTypeMarker--${play.playType}`}
                        aria-label={play.playType === "reminder" ? "Reminder" : "Normal Play"}
                      />
                      <span
                        className="playPlayerCell"
                        data-testid={selectedView.kind === "all"
                          ? "play-destination"
                          : play.playerDisplayName
                            ? "play-player"
                            : undefined}
                        title={playRowLeadingLabel(
                          play,
                          baskets,
                          selectedView.kind === "all",
                        ) || undefined}
                      >
                        {playRowLeadingLabel(play, baskets, selectedView.kind === "all")}
                      </span>
                      <PlayForm
                        baskets={baskets}
                        defaultPlacement={defaultPlacement}
                        nextPlayOptions={nextPlayOptions}
                        play={play}
                        supportsWorkflows={supportsWorkflows}
                      />
                    </div>
                    <span className="playDataCell">
                      {play.durationMinutes ? `${play.durationMinutes}m` : "—"}
                    </span>
                    <span className="playDataCell" title={play.branch ?? undefined}>
                      {displayBranch(play.branch) ?? "—"}
                    </span>
                    <span className="playDataCell playPlaceCell">
                      {play.place ?? "—"}
                    </span>
                    <PlayStatusActions play={play} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
