"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useState,
  useTransition,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
} from "react";

import { signOut } from "../app/auth/actions";
import { repositionPlays } from "../app/plays/actions";
import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
  PlayPlacement,
} from "../domain/play";
import type { SelectedView } from "../lib/playhouse/data";
import {
  displayBranch,
  playRowLeadingLabel,
  usesDateLeadingColumn,
} from "../domain/play-display";
import { CALENDAR_VIEWS } from "../domain/playhouse-navigation";
import { togglePlaySelection } from "../domain/play-selection";
import { playVisualForPlay } from "../domain/play-visual";
import { BrowserTimeZone } from "./browser-time-zone";
import { PlayForm } from "./play-form";
import { PlayStatusActions } from "./play-status-actions";

export type UserIdentity = {
  displayName: string;
  email: string | null;
};

type PlayhouseShellProps = {
  baskets: BasketSummary[];
  dataError: boolean;
  identity: UserIdentity;
  nextPlayOptions: NextPlayOption[];
  plays: PlayListItem[];
  selectedView: SelectedView;
  supportsWorkflows: boolean;
  todayDate: string;
};

function selectedViewIdentity(selectedView: SelectedView) {
  return selectedView.kind === "basket"
    ? `basket:${selectedView.basket.id}`
    : selectedView.kind === "calendar"
      ? `calendar:${selectedView.key}:${selectedView.startDate}`
      : `all:${selectedView.defaultDate}`;
}

function addCalendarDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function PlayhouseShell(props: PlayhouseShellProps) {
  return <PlayhouseShellView key={selectedViewIdentity(props.selectedView)} {...props} />;
}

function PlayhouseShellView({
  baskets,
  dataError,
  identity,
  nextPlayOptions,
  plays,
  selectedView,
  supportsWorkflows,
  todayDate,
}: PlayhouseShellProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [draggedIds, setDraggedIds] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [movePending, startMove] = useTransition();
  const playCountLabel = `${plays.length} ${plays.length === 1 ? "Play" : "Plays"}`;
  const visibleIds = plays.map((play) => play.id);
  const showDateInLeadingColumn = usesDateLeadingColumn(selectedView);
  const defaultPlacement =
    selectedView.kind === "basket"
      ? { basketId: selectedView.basket.id, kind: "basket" as const }
      : {
          kind: "calendar" as const,
          scheduledDate: selectedView.kind === "all"
            ? selectedView.defaultDate
            : selectedView.startDate,
        };
  const reorderPlacement: PlayPlacement | null = selectedView.kind === "basket"
    ? { basketId: selectedView.basket.id, kind: "basket" }
    : selectedView.kind === "calendar" && selectedView.key !== "week"
      ? { kind: "calendar", scheduledDate: selectedView.startDate }
      : null;
  function toggleSelection(playId: string, event: MouseEvent<HTMLButtonElement>) {
    setSelectedIds((current) => togglePlaySelection({
      anchorId: selectionAnchor,
      clickedId: playId,
      selectedIds: current,
      shiftKey: event.shiftKey,
      visibleIds,
    }));
    setSelectionAnchor(playId);
  }

  function beginDrag(playId: string, event: DragEvent<HTMLButtonElement>) {
    const ids = selectedIds.has(playId)
      ? visibleIds.filter((id) => selectedIds.has(id))
      : [playId];
    if (!selectedIds.has(playId)) {
      setSelectedIds(new Set([playId]));
      setSelectionAnchor(playId);
    }
    setDraggedIds(ids);
    setMoveError(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ids.join(","));
  }

  function persistMove(placement: PlayPlacement, beforePlayId: string | null) {
    if (!draggedIds.length || movePending) return;
    const playIds = visibleIds.filter((id) => draggedIds.includes(id));
    startMove(async () => {
      const result = await repositionPlays({ beforePlayId, placement, playIds });
      setDraggedIds([]);
      setDropTarget(null);
      if (result.status === "success") {
        setSelectedIds(new Set());
        setSelectionAnchor(null);
        setMoveError(null);
      } else {
        setMoveError(result.message);
      }
      router.refresh();
    });
  }

  function destinationDropProps(placement: PlayPlacement, key: string) {
    return {
      "data-drop-target": dropTarget === key || undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!draggedIds.length) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(key);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        persistMove(placement, null);
      },
    };
  }

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

                  const dropPlacement = item.key === "today"
                    ? { kind: "calendar" as const, scheduledDate: todayDate }
                    : item.key === "tomorrow"
                      ? { kind: "calendar" as const, scheduledDate: addCalendarDays(todayDate, 1) }
                      : null;

                  return (
                    <Link
                      aria-current={isActive ? "page" : undefined}
                      className="destinationLink"
                      data-active={isActive || undefined}
                      href={`/?view=${item.key}`}
                      key={item.key}
                      {...(dropPlacement
                        ? destinationDropProps(dropPlacement, `calendar:${item.key}`)
                        : {})}
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
                      {...destinationDropProps(
                        { basketId: basket.id, kind: "basket" },
                        `basket:${basket.id}`,
                      )}
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
              {plays.length ? (
                <div className="selectionToolbar" aria-label="Play selection controls">
                  <span>{selectedIds.size} selected</span>
                  <button
                    disabled={movePending || selectedIds.size === plays.length}
                    onClick={() => setSelectedIds(new Set(visibleIds))}
                    type="button"
                  >
                    Select All
                  </button>
                  <button
                    aria-label="Clear Selection"
                    disabled={movePending || selectedIds.size === 0}
                    onClick={() => {
                      setSelectedIds(new Set());
                      setSelectionAnchor(null);
                    }}
                    type="button"
                  >
                    Clear
                  </button>
                </div>
              ) : null}
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
            <>
              {moveError ? <p className="moveError" role="alert">{moveError}</p> : null}
              <ol
                aria-busy={movePending}
                className="playList"
                aria-label={`Open Plays in ${selectedView.label}`}
              >
                {plays.map((play) => {
                  const playVisual = playVisualForPlay(play);
                  return (
                <li
                  className={`playRow ${playVisual.className}`}
                  data-dragging={draggedIds.includes(play.id) || undefined}
                  data-drop-target={dropTarget === `play:${play.id}` || undefined}
                  data-selected={selectedIds.has(play.id) || undefined}
                  data-testid="play-row"
                  key={play.id}
                  style={{
                    "--play-rank-background": playVisual.backgroundColor,
                    "--play-rank-foreground": playVisual.foregroundColor,
                  } as CSSProperties}
                  onDragOver={(event) => {
                    if (!reorderPlacement || !draggedIds.length || draggedIds.includes(play.id)) {
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTarget(`play:${play.id}`);
                  }}
                  onDrop={(event) => {
                    if (!reorderPlacement || draggedIds.includes(play.id)) return;
                    event.preventDefault();
                    persistMove(reorderPlacement, play.id);
                  }}
                >
                  <div className="playRowLine">
                    <div className="playIdentityCell">
                      <button
                        aria-label={`${selectedIds.has(play.id) ? "Deselect" : "Select"} ${playVisual.label} Play ${play.title}`}
                        aria-pressed={selectedIds.has(play.id)}
                        className="playSelectControl"
                        disabled={movePending}
                        draggable
                        onClick={(event) => toggleSelection(play.id, event)}
                        onDragEnd={() => {
                          setDraggedIds([]);
                          setDropTarget(null);
                        }}
                        onDragStart={(event) => beginDrag(play.id, event)}
                        title="Select or drag Play"
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className={`playTypeMarker ${playVisual.markerClassName}`}
                          data-play-visual={playVisual.visualType}
                          title={playVisual.label}
                        />
                      </button>
                      <span
                        className="playPlayerCell"
                        data-testid={showDateInLeadingColumn
                          ? "play-destination"
                          : play.playerDisplayName
                            ? "play-player"
                            : undefined}
                        title={playRowLeadingLabel(
                          play,
                          baskets,
                          showDateInLeadingColumn,
                        ) || undefined}
                      >
                        {playRowLeadingLabel(play, baskets, showDateInLeadingColumn)}
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
                  );
                })}
              </ol>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
