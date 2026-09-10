"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { bulkUpdatePlays, flipPlayRank, repositionPlays } from "../app/plays/actions";
import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
  PlayPlacement,
} from "../domain/play";
import type { CalendarSettingsAccount } from "../domain/calendar-settings";
import type { SelectedView } from "../lib/playhouse/data";
import {
  displayBranch,
  playRowLeadingLabel,
  usesDateLeadingColumn,
} from "../domain/play-display";
import {
  CALENDAR_VIEWS,
  calendarDateHref,
  friendlyCalendarDate,
  isSelectableCalendarDate,
  rollingCalendarDates,
  sidebarSectionForView,
} from "../domain/playhouse-navigation";
import {
  beginRegionSelection,
  exceedsRegionSelectionDragThreshold,
  regionSelectionPlayIdAtPoint,
  togglePlaySelection,
  touchRegionSelection,
  type RegionSelectionGesture,
} from "../domain/play-selection";
import {
  isBulkSelectablePlay,
  optimisticallyApplyBulkChange,
  optimisticallyFlipPlayRank,
  type BulkPlayChange,
} from "../domain/play-bulk-change";
import { optimisticallyRepositionPlays } from "../domain/play-optimistic-reorder";
import {
  sortPlaysForGrid,
  type PlayGridSort,
} from "../domain/play-grid-sort";
import { playVisualForPlay } from "../domain/play-visual";
import { compareChronologicalPlays, comparePlayRankAndPriority } from "../domain/play-sort";
import { reminderContextDate, reminderDateError } from "../domain/reminder";
import { AccountMenu } from "./account-menu";
import { BulkPlayContextMenu } from "./bulk-play-context-menu";
import { BrowserTimeZone } from "./browser-time-zone";
import { useGridFontSizePreference } from "./grid-settings";
import { PlayForm, ReminderDatePrompt } from "./play-form";
import { PlaySearch } from "./play-search";
import {
  BrowserIcon,
  DoneIcon,
  FlipRankIcon,
  GmailIcon,
  PlayStatusActions,
  TrashIcon,
} from "./play-status-actions";

export type UserIdentity = {
  displayName: string;
  email: string | null;
};

type PlayhouseShellProps = {
  baskets: BasketSummary[];
  calendarAccounts: CalendarSettingsAccount[];
  calendarSettingsError: boolean;
  dataError: boolean;
  identity: UserIdentity;
  nextPlayOptions: NextPlayOption[];
  plays: PlayListItem[];
  selectedView: SelectedView;
  searchQuery: string;
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

function isInteractiveDragOrigin(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    "button, a, input, select, textarea, label, form, [contenteditable='true'], " +
    "[role='button'], [role='link'], [role='menuitem'], .editDisclosure[open]",
  ));
}

function GridSortHeader({
  column,
  label,
  onSort,
  sort,
}: {
  column: PlayGridSort["column"];
  label: string;
  onSort: (sort: PlayGridSort) => void;
  sort: PlayGridSort | null;
}) {
  return (
    <div
      aria-sort={sort?.column === column
        ? sort.direction === "asc" ? "ascending" : "descending"
        : "none"}
      className="playGridSortHeader"
      role="columnheader"
    >
      <span>{label}</span>
      <span className="playGridSortControls">
        {(["asc", "desc"] as const).map((direction) => (
          <button
            aria-label={`Sort ${label} ${direction === "asc" ? "ascending" : "descending"}`}
            aria-pressed={sort?.column === column && sort.direction === direction}
            key={direction}
            onClick={() => onSort({ column, direction })}
            type="button"
          >
            {direction === "asc" ? "↑" : "↓"}
          </button>
        ))}
      </span>
    </div>
  );
}

function GridIconSortHeader({
  children,
  column,
  label,
  onSort,
  sort,
}: {
  children: ReactNode;
  column: "gmail" | "url";
  label: string;
  onSort: (sort: PlayGridSort) => void;
  sort: PlayGridSort | null;
}) {
  const active = sort?.column === column;
  const direction = active ? sort.direction : null;
  return (
    <span
      aria-label={column === "gmail" ? "Gmail" : "URL"}
      aria-sort={direction === "asc"
        ? "ascending"
        : direction === "desc" ? "descending" : "none"}
      className="playGridIconSortHeader"
      role="columnheader"
    >
      <button
        aria-label={`Sort by ${label}`}
        aria-pressed={active}
        onClick={() => onSort({
          column,
          direction: direction === "asc" ? "desc" : "asc",
        })}
        title={`Sort by ${label}`}
        type="button"
      >
        {children}
        {direction ? (
          <span aria-hidden="true" className="playGridIconSortIndicator">
            {direction === "asc" ? "↑" : "↓"}
          </span>
        ) : null}
      </button>
    </span>
  );
}

export function PlayhouseShell(props: PlayhouseShellProps) {
  return <PlayhouseShellView key={selectedViewIdentity(props.selectedView)} {...props} />;
}

function PlayhouseShellView({
  baskets,
  calendarAccounts,
  calendarSettingsError,
  dataError,
  identity,
  nextPlayOptions,
  plays,
  selectedView,
  searchQuery,
  supportsWorkflows,
  todayDate,
}: PlayhouseShellProps) {
  const router = useRouter();
  const gridFontSize = useGridFontSizePreference();
  const datePickerRef = useRef<HTMLInputElement>(null);
  const dragOriginAllowedRef = useRef(true);
  const dragPreviewHostRef = useRef<HTMLDivElement>(null);
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const regionSelectionRef = useRef<(RegionSelectionGesture & {
    active: boolean;
    owner: HTMLElement;
    pointerId: number;
    startX: number;
    startY: number;
  }) | null>(null);
  const eligiblePlayIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [sidebarSection, setSidebarSection] = useState(() =>
    sidebarSectionForView(selectedView.kind)
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [draggedIds, setDraggedIds] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [gridSort, setGridSort] = useState<PlayGridSort | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [rankFlipPrompt, setRankFlipPrompt] = useState<{
    date: string;
    message: string | null;
    play: PlayListItem;
  } | null>(null);
  const [flippingPlayId, setFlippingPlayId] = useState<string | null>(null);
  const [optimisticPlays, setOptimisticPlays] = useState<{
    source: PlayListItem[];
    value: PlayListItem[];
  } | null>(null);
  const [movePending, startMove] = useTransition();
  const [bulkPending, startBulk] = useTransition();
  const [flipPending, startFlip] = useTransition();
  const localPlays = optimisticPlays?.source === plays ? optimisticPlays.value : plays;
  const playCountLabel = `${localPlays.length} ${localPlays.length === 1 ? "Play" : "Plays"}`;
  const viewTitle = !searchQuery && selectedView.kind === "calendar" &&
      selectedView.key !== "week"
    ? friendlyCalendarDate(selectedView.startDate)
    : searchQuery
      ? "Search Results"
      : selectedView.label;
  const visiblePlays = useMemo(
    () => sortPlaysForGrid(localPlays, gridSort),
    [gridSort, localPlays],
  );
  const visibleIds = visiblePlays.map((play) => play.id);
  const eligiblePlayIds = useMemo(() => new Set(
    localPlays.filter(isBulkSelectablePlay).map((play) => play.id),
  ), [localPlays]);
  useEffect(() => {
    eligiblePlayIdsRef.current = eligiblePlayIds;
  }, [eligiblePlayIds]);
  const eligibleVisibleIds = visibleIds.filter((id) => eligiblePlayIds.has(id));
  const sidebarDates = rollingCalendarDates(todayDate);
  const showDateInLeadingColumn = Boolean(searchQuery) || usesDateLeadingColumn(selectedView);
  const defaultPlacement =
    selectedView.kind === "basket"
      ? { basketId: selectedView.basket.id, kind: "basket" as const }
      : {
          kind: "calendar" as const,
          scheduledDate: selectedView.kind === "all"
            ? selectedView.defaultDate
            : selectedView.startDate,
        };
  const displayedReminderDate =
    selectedView.kind === "calendar" && selectedView.key !== "week"
      ? selectedView.startDate
      : null;
  const reorderPlacement: PlayPlacement | null = searchQuery
    ? null
    : selectedView.kind === "basket"
    ? { basketId: selectedView.basket.id, kind: "basket" }
    : selectedView.kind === "calendar" && selectedView.key !== "week"
      ? { kind: "calendar", scheduledDate: selectedView.startDate }
      : null;
  function isCurrentPlacement(placement: PlayPlacement) {
    if (!reorderPlacement) return false;
    if (placement.kind === "calendar") {
      return reorderPlacement.kind === "calendar" &&
        placement.scheduledDate === reorderPlacement.scheduledDate;
    }
    return reorderPlacement.kind === "basket" &&
      placement.basketId === reorderPlacement.basketId;
  }
  function toggleSelection(playId: string, event: MouseEvent<HTMLButtonElement>) {
    if (!eligiblePlayIds.has(playId)) return;
    setSelectedIds((current) => togglePlaySelection({
      anchorId: selectionAnchor,
      clickedId: playId,
      selectedIds: current,
      shiftKey: event.shiftKey,
      visibleIds: eligibleVisibleIds,
    }));
    setSelectionAnchor(playId);
  }

  function rememberDragOrigin(event: ReactPointerEvent<HTMLElement>) {
    dragOriginAllowedRef.current = !isInteractiveDragOrigin(event.target);
  }

  function clearDragState() {
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
    setDraggedIds([]);
    setDropTarget(null);
  }

  function beginDrag(playId: string, event: DragEvent<HTMLLIElement>) {
    if (!dragOriginAllowedRef.current || selectedIds.size > 0) {
      event.preventDefault();
      return;
    }

    const row = event.currentTarget;
    const previewHost = dragPreviewHostRef.current;
    if (!previewHost) {
      event.preventDefault();
      return;
    }
    const bounds = row.getBoundingClientRect();
    const rowStyle = getComputedStyle(row);
    const preview = row.cloneNode(true) as HTMLElement;
    preview.classList.add("playDragPreview");
    preview.dataset.dragPreview = "true";
    preview.style.setProperty("--play-grid-font-size", rowStyle.fontSize);
    preview.style.width = `${bounds.width}px`;
    preview.style.height = `${bounds.height}px`;
    dragPreviewRef.current?.remove();
    previewHost.replaceChildren(preview);
    dragPreviewRef.current = preview;
    preview.getBoundingClientRect();
    event.dataTransfer.setDragImage(
      preview,
      Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width),
      Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height),
    );

    const ids = [playId];
    setDraggedIds(ids);
    setMoveError(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ids.join(","));
  }

  function beginRegionDrag(event: ReactPointerEvent<HTMLElement>) {
    if (
      event.button !== 0 ||
      !(event.target instanceof Element) ||
      event.target.closest(
        ".sidebar, .playList, .playGridHeader, .playRow, button, a, input, select, " +
        "textarea, details, summary, [role='menu']",
      )
    ) return;
    regionSelectionRef.current = {
      ...beginRegionSelection(selectedIds),
      active: false,
      owner: event.currentTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.dataset.regionSelecting = "true";
    window.getSelection()?.removeAllRanges();
    event.preventDefault();
  }

  useEffect(() => {
    function continueRegionDrag(event: PointerEvent) {
      const gesture = regionSelectionRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (!gesture.active) {
        if (!exceedsRegionSelectionDragThreshold(
          gesture.startX,
          gesture.startY,
          event.clientX,
          event.clientY,
        )) {
          event.preventDefault();
          return;
        }
        gesture.active = true;
      }
      const playId = regionSelectionPlayIdAtPoint(
        document,
        event.clientX,
        event.clientY,
      );
      if (!playId || !eligiblePlayIdsRef.current.has(playId)) return;
      if (touchRegionSelection(gesture, playId)) {
        setSelectedIds(new Set(gesture.selectedIds));
        setSelectionAnchor(playId);
      }
      event.preventDefault();
    }

    function endRegionDrag(event: PointerEvent) {
      const gesture = regionSelectionRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      regionSelectionRef.current = null;
      delete gesture.owner.dataset.regionSelecting;
      if (!gesture.active) {
        setSelectedIds(new Set());
        setSelectionAnchor(null);
      }
    }

    function endRegionDragOnBlur() {
      const gesture = regionSelectionRef.current;
      if (!gesture) return;
      delete gesture.owner.dataset.regionSelecting;
      regionSelectionRef.current = null;
    }

    window.addEventListener("pointermove", continueRegionDrag, { passive: false });
    window.addEventListener("pointerup", endRegionDrag);
    window.addEventListener("pointercancel", endRegionDrag);
    window.addEventListener("blur", endRegionDragOnBlur);
    return () => {
      window.removeEventListener("pointermove", continueRegionDrag);
      window.removeEventListener("pointerup", endRegionDrag);
      window.removeEventListener("pointercancel", endRegionDrag);
      window.removeEventListener("blur", endRegionDragOnBlur);
      const gesture = regionSelectionRef.current;
      if (gesture) delete gesture.owner.dataset.regionSelecting;
      regionSelectionRef.current = null;
    };
  }, []);

  function openBulkMenu(playId: string, event: MouseEvent<HTMLLIElement>) {
    if (!eligiblePlayIds.has(playId)) return;
    event.preventDefault();
    if (!selectedIds.has(playId)) {
      setSelectedIds(new Set([playId]));
      setSelectionAnchor(playId);
    }
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 230)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 360)),
    });
  }

  function applyBulkChange(change: BulkPlayChange) {
    const playIds = visibleIds.filter((id) => selectedIds.has(id) && eligiblePlayIds.has(id));
    if (!playIds.length || bulkPending) return;
    const previousOptimisticPlays = optimisticPlays;
    const previousSelection = selectedIds;
    const keepMovedInView = change.kind === "move"
      ? isCurrentPlacement(change.placement)
      : change.kind !== "rank" || change.playType !== "reminder" ||
        selectedView.kind !== "basket";
    let nextPlays = optimisticallyApplyBulkChange(
      localPlays,
      new Set(playIds),
      change,
      keepMovedInView,
    );
    if (change.kind === "rank") {
      const multiDate = Boolean(searchQuery) || selectedView.kind === "all" ||
        (selectedView.kind === "calendar" && selectedView.key === "week");
      nextPlays = [...nextPlays].sort(
        multiDate ? compareChronologicalPlays : comparePlayRankAndPriority,
      );
    }
    setOptimisticPlays({ source: plays, value: nextPlays });
    setSelectedIds(new Set(playIds.filter((id) => nextPlays.some((play) => play.id === id))));
    setContextMenu(null);
    startBulk(async () => {
      try {
        const result = await bulkUpdatePlays({ change, playIds });
        if (result.status === "success") {
          setMoveError(null);
          return;
        }
        setOptimisticPlays(previousOptimisticPlays);
        setSelectedIds(previousSelection);
        setMoveError(result.message);
      } catch {
        setOptimisticPlays(previousOptimisticPlays);
        setSelectedIds(previousSelection);
        setMoveError("PlayHouse could not change these Plays. The previous values were restored.");
      }
    });
  }

  function applyRankFlip(play: PlayListItem, playType: "normal" | "reminder", date: string) {
    if (flipPending) return;
    const previousOptimisticPlays = optimisticPlays;
    const keepMovedInView = playType !== "reminder" || selectedView.kind !== "basket";
    let nextPlays = optimisticallyFlipPlayRank(
      localPlays,
      play.id,
      playType,
      date,
      keepMovedInView,
    );
    const multiDate = Boolean(searchQuery) || selectedView.kind === "all" ||
      (selectedView.kind === "calendar" && selectedView.key === "week");
    nextPlays = [...nextPlays].sort(
      multiDate ? compareChronologicalPlays : comparePlayRankAndPriority,
    );
    setOptimisticPlays({ source: plays, value: nextPlays });
    setFlippingPlayId(play.id);
    setRankFlipPrompt(null);
    startFlip(async () => {
      try {
        const result = await flipPlayRank({ playId: play.id, playType, reminderDate: date });
        if (result.status === "success") {
          setMoveError(null);
          setFlippingPlayId(null);
          return;
        }
        setOptimisticPlays(previousOptimisticPlays);
        setFlippingPlayId(null);
        setMoveError(result.message);
      } catch {
        setOptimisticPlays(previousOptimisticPlays);
        setFlippingPlayId(null);
        setMoveError("This Play's rank could not be changed. The previous rank was restored.");
      }
    });
  }

  function requestRankFlip(play: PlayListItem) {
    const visualType = playVisualForPlay(play).visualType;
    if (visualType === "appointment") return;
    const date = reminderContextDate({
      displayedDate: displayedReminderDate,
      scheduledDate: play.scheduledDate,
      todayDate,
    });
    if (visualType === "reminder") {
      applyRankFlip(play, "normal", date);
      return;
    }
    setRankFlipPrompt({ date, message: null, play });
  }

  function persistMove(placement: PlayPlacement, beforePlayId: string | null) {
    if (!draggedIds.length || movePending) return;
    const playIds = visibleIds.filter((id) => draggedIds.includes(id));
    const previousOptimisticPlays = optimisticPlays;
    setOptimisticPlays({
      source: plays,
      value: optimisticallyRepositionPlays({
        beforePlayId,
        keepInCurrentView: isCurrentPlacement(placement),
        playIds,
        plays: localPlays,
      }),
    });
    setDraggedIds([]);
    setDropTarget(null);
    startMove(async () => {
      try {
        const result = await repositionPlays({ beforePlayId, placement, playIds });
        if (result.status !== "success") {
          setOptimisticPlays(previousOptimisticPlays);
          setMoveError(result.message);
          return;
        }
        setSelectedIds(new Set());
        setSelectionAnchor(null);
        setMoveError(null);
      } catch {
        setOptimisticPlays(previousOptimisticPlays);
        setMoveError("PlayHouse could not move these Plays. The previous order was restored.");
      }
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
      <div aria-hidden="true" className="playDragPreviewHost" ref={dragPreviewHostRef} />
      <span className="deploymentBuildMarker">P2-EVENTS-1</span>
      <header className="appHeader">
        <div className="headerBrandArea">
          <Link className="brand" href="/?view=today" aria-label="Carnival PlayHouse home">
            <span className="brandMark" aria-hidden="true">
              C
            </span>
            <span>
              <strong>Carnival</strong>
              <small>PlayHouse</small>
            </span>
          </Link>
          <span
            aria-label={`${playCountLabel} open`}
            className="countBadge headerPlayCount"
            data-testid="play-count"
          >
            {playCountLabel}
          </span>
        </div>
        <h1 className="headerViewTitle" id="view-title">{viewTitle}</h1>
        <div className="headerActions">
          <PlaySearch initialQuery={searchQuery} />
          {!dataError ? (
            <PlayForm
              baskets={baskets}
              defaultPlacement={defaultPlacement}
              nextPlayOptions={nextPlayOptions}
              supportsWorkflows={supportsWorkflows}
              reminderContextDate={reminderContextDate({
                displayedDate: displayedReminderDate,
                todayDate,
              })}
            />
          ) : null}
          <AccountMenu
            calendarAccounts={calendarAccounts}
            calendarSettingsError={calendarSettingsError}
            displayName={identity.displayName}
            email={identity.email}
            fontSize={gridFontSize}
          />
        </div>
      </header>

      <div
        className="workspaceBody"
        data-playhouse-selection-surface="true"
        onPointerDown={beginRegionDrag}
      >
        <aside className="sidebar" aria-label="Play destinations">
          <nav className="destinationNav">
            <div aria-label="Navigation section" className="sidebarSectionToggle" role="group">
              <button
                aria-controls="calendar-navigation"
                aria-pressed={sidebarSection === "calendar"}
                data-active={sidebarSection === "calendar" || undefined}
                onClick={() => setSidebarSection("calendar")}
                type="button"
              >
                Calendar
              </button>
              <button
                aria-controls="basket-navigation"
                aria-pressed={sidebarSection === "baskets"}
                data-active={sidebarSection === "baskets" || undefined}
                onClick={() => {
                  setDatePickerOpen(false);
                  setSidebarSection("baskets");
                }}
                type="button"
              >
                Baskets
              </button>
            </div>
            {sidebarSection === "calendar" ? (
              <div
                aria-label="Calendar destinations"
                className="navItems"
                id="calendar-navigation"
              >
                {sidebarDates.map((item) => {
                  const isActive = selectedView.kind === "calendar" &&
                    selectedView.key !== "week" &&
                    selectedView.startDate === item.date;
                  const placement = {
                    kind: "calendar" as const,
                    scheduledDate: item.date,
                  };
                  return (
                    <Link
                      aria-current={isActive ? "page" : undefined}
                      className="destinationLink"
                      data-active={isActive || undefined}
                      href={calendarDateHref(item.date, todayDate)}
                      key={item.date}
                      {...destinationDropProps(placement, `calendar:${item.date}`)}
                    >
                      <span className="destinationIcon" aria-hidden="true">
                        {item.marker}
                      </span>
                      {item.label}
                    </Link>
                  );
                })}
                {CALENDAR_VIEWS.map((item) => {
                  const isActive =
                    (selectedView.kind === "calendar" || selectedView.kind === "all") &&
                    selectedView.key === item.key;

                  if (item.key === "date") {
                    const selectedDate = selectedView.kind === "calendar" &&
                        selectedView.key === "date"
                      ? selectedView.startDate
                      : "";
                    const isDatePickerActive = Boolean(
                      selectedDate && !sidebarDates.some(({ date }) => date === selectedDate),
                    );
                    return (
                      <div className="goToDateControl" key={item.key}>
                        <button
                          aria-label="Go to Date"
                          aria-controls="go-to-date-picker"
                          aria-current={isDatePickerActive ? "page" : undefined}
                          aria-expanded={datePickerOpen}
                          className="destinationLink goToDateLink"
                          data-active={isDatePickerActive || undefined}
                          onClick={() => {
                            const picker = datePickerRef.current;
                            if (!picker) return;
                            try {
                              if (typeof picker.showPicker === "function") {
                                picker.showPicker();
                                return;
                              }
                            } catch {
                              // Fall through to the visible native-input fallback.
                            }
                            setDatePickerOpen(true);
                          }}
                          type="button"
                        >
                          <span className="destinationIcon" aria-hidden="true">
                            {item.marker}
                          </span>
                          {item.label}
                        </button>
                        <input
                          aria-label="Go to Date"
                          className="goToDateInput"
                          data-open={datePickerOpen || undefined}
                          id="go-to-date-picker"
                          min={todayDate}
                          onChange={(event) => {
                            if (isSelectableCalendarDate(event.target.value, todayDate)) {
                              setDatePickerOpen(false);
                              router.push(calendarDateHref(event.target.value, todayDate));
                            } else {
                              event.target.value = selectedDate;
                            }
                          }}
                          ref={datePickerRef}
                          tabIndex={datePickerOpen ? 0 : -1}
                          type="date"
                          value={selectedDate}
                        />
                      </div>
                    );
                  }

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
            ) : (
              <div
                aria-label="Basket destinations"
                className="navItems"
                id="basket-navigation"
              >
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
            )}
          </nav>
        </aside>

        <section
          className="playPanel"
          aria-labelledby="view-title"
          style={{ "--play-grid-font-size": `${gridFontSize}px` } as CSSProperties}
        >
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
          ) : localPlays.length === 0 ? (
            <div className="emptyState">
              <span className="spark" aria-hidden="true">
                ✦
              </span>
              <h2>{searchQuery ? "No Plays found" : "No Plays here yet."}</h2>
              <p>
                {searchQuery
                  ? "Try another search, or clear it to return to this view."
                  : "Create a Play here, or choose another calendar date or Basket."}
              </p>
            </div>
          ) : (
            <>
              {moveError ? <p className="moveError" role="alert">{moveError}</p> : null}
              <div className="playGridHeader" role="row">
                <div className="playIdentityCell">
                  <span aria-hidden="true" />
                  <GridSortHeader
                    column="assignee"
                    label="Assignee"
                    onSort={setGridSort}
                    sort={gridSort}
                  />
                  <GridSortHeader
                    column="description"
                    label="Description"
                    onSort={setGridSort}
                    sort={gridSort}
                  />
                </div>
                <GridSortHeader
                  column="branch"
                  label="Branch"
                  onSort={setGridSort}
                  sort={gridSort}
                />
                <div className="statusActions playGridActionHeaders">
                  <span aria-label="Done" role="columnheader" title="Done"><DoneIcon /></span>
                  <span aria-label="Trash" role="columnheader" title="Trash"><TrashIcon /></span>
                  <GridIconSortHeader
                    column="gmail"
                    label="Gmail linkage"
                    onSort={setGridSort}
                    sort={gridSort}
                  >
                    <GmailIcon />
                  </GridIconSortHeader>
                  <GridIconSortHeader
                    column="url"
                    label="URL"
                    onSort={setGridSort}
                    sort={gridSort}
                  >
                    <BrowserIcon />
                  </GridIconSortHeader>
                  <span aria-label="Flip rank" role="columnheader" title="Flip rank">
                    <FlipRankIcon />
                  </span>
                </div>
              </div>
              <ol
                aria-busy={movePending || bulkPending}
                className="playList"
                aria-label={`Open Plays in ${selectedView.label}`}
              >
                {visiblePlays.map((play) => {
                  const playVisual = playVisualForPlay(play);
                  return (
                <li
                  className={`playRow ${playVisual.className}`}
                  data-dragging={draggedIds.includes(play.id) || undefined}
                  data-drop-target={dropTarget === `play:${play.id}` || undefined}
                  data-selected={selectedIds.has(play.id) || undefined}
                  data-testid="play-row"
                  data-play-row-id={play.id}
                  key={play.id}
                  draggable={!searchQuery && selectedIds.size === 0}
                  onClickCapture={(event) => {
                    if (!(event.ctrlKey || event.metaKey) || !eligiblePlayIds.has(play.id)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (next.has(play.id)) next.delete(play.id);
                      else next.add(play.id);
                      return next;
                    });
                    setSelectionAnchor(play.id);
                  }}
                  onContextMenu={(event) => openBulkMenu(play.id, event)}
                  onDragEnd={clearDragState}
                  onDragStart={(event) => beginDrag(play.id, event)}
                  onPointerDownCapture={rememberDragOrigin}
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
                        disabled={movePending || bulkPending || !eligiblePlayIds.has(play.id)}
                        onClick={(event) => toggleSelection(play.id, event)}
                        title="Select Play"
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
                        reminderContextDate={reminderContextDate({
                          displayedDate: displayedReminderDate,
                          scheduledDate: play.scheduledDate,
                          todayDate,
                        })}
                      />
                    </div>
                    <span className="playDataCell" title={play.branch ?? undefined}>
                      {displayBranch(play.branch) ?? "—"}
                    </span>
                    <PlayStatusActions
                      flipPending={flipPending && flippingPlayId === play.id}
                      onFlipRank={playVisual.visualType === "appointment"
                        ? undefined
                        : () => requestRankFlip(play)}
                      play={play}
                    />
                  </div>
                </li>
                  );
                })}
              </ol>
              {contextMenu ? (
                <BulkPlayContextMenu
                  baskets={baskets}
                  onApply={applyBulkChange}
                  onClose={() => setContextMenu(null)}
                  reminderDate={reminderContextDate({
                    displayedDate: displayedReminderDate,
                    todayDate,
                  })}
                  todayDate={todayDate}
                  x={contextMenu.x}
                  y={contextMenu.y}
                />
              ) : null}
              {rankFlipPrompt ? (
                <ReminderDatePrompt
                  dialogId={`flip-reminder-date-${rankFlipPrompt.play.id}`}
                  message={rankFlipPrompt.message}
                  minimumDate={reminderContextDate({
                    displayedDate: displayedReminderDate,
                    scheduledDate: rankFlipPrompt.play.scheduledDate,
                    todayDate,
                  })}
                  onCancel={() => setRankFlipPrompt(null)}
                  onChange={(date) => setRankFlipPrompt((current) => current
                    ? { ...current, date, message: null }
                    : null)}
                  onConfirm={() => {
                    const minimumDate = reminderContextDate({
                      displayedDate: displayedReminderDate,
                      scheduledDate: rankFlipPrompt.play.scheduledDate,
                      todayDate,
                    });
                    const message = reminderDateError(
                      { kind: "calendar", scheduledDate: rankFlipPrompt.date },
                      minimumDate,
                    );
                    if (message) {
                      setRankFlipPrompt({ ...rankFlipPrompt, message });
                      return;
                    }
                    applyRankFlip(rankFlipPrompt.play, "reminder", rankFlipPrompt.date);
                  }}
                  value={rankFlipPrompt.date}
                />
              ) : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
