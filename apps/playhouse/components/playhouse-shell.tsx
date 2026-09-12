"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useCallback,
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

import {
  attachGmailToPlay,
  bulkSetPlayStatus,
  bulkUpdatePlays,
  flipPlayRank,
  repositionPlays,
} from "../app/plays/actions";
import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
  PlayPlacement,
} from "../domain/play";
import type { CalendarSettingsAccount } from "../domain/calendar-settings";
import {
  gmailAttachmentFromDragData,
  gmailCorrelationIdFromDragData,
  gmailMetadataWithAttachment,
  mayContainGmailDrag,
  parseGmailAttachmentUrl,
  type GmailAttachment,
} from "../domain/gmail-attachment";
import { sanitizeGmailThreadContext } from "../domain/gmail-thread-context";
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
} from "../domain/playhouse-navigation";
import {
  beginRegionSelection,
  exceedsRegionSelectionDragThreshold,
  regionSelectionPlayIdAtPoint,
  playIdsForDrag,
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
import { reminderContextDate } from "../domain/reminder";
import { AccountMenu } from "./account-menu";
import { BrowserTimeZone } from "./browser-time-zone";
import { useGridFontSizePreference } from "./grid-settings";
import { PlayForm } from "./play-form";
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

type BullseyeCategory = "calendar" | "baskets" | "rank" | "push";

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
  const dragIconRef = useRef<HTMLElement | null>(null);
  const dragPointerOffsetRef = useRef({ x: 0, y: 0 });
  const playListRef = useRef<HTMLOListElement>(null);
  const regionSelectionRef = useRef<(RegionSelectionGesture & {
    active: boolean;
    owner: HTMLElement;
    pointerId: number;
    startX: number;
    startY: number;
  }) | null>(null);
  const eligiblePlayIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [draggedIds, setDraggedIds] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [bullseyeOpen, setBullseyeOpen] = useState(false);
  const [bullseyeCategory, setBullseyeCategory] = useState<BullseyeCategory>("calendar");
  const gmailCorrelationIdRef = useRef<string | null>(null);
  const gmailDropTargetRef = useRef<string | null>(null);
  const [gmailDropTarget, setGmailDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [gridSort, setGridSort] = useState<PlayGridSort | null>(null);
  const [flippingPlayId, setFlippingPlayId] = useState<string | null>(null);
  const [optimisticPlays, setOptimisticPlays] = useState<{
    source: PlayListItem[];
    value: PlayListItem[];
  } | null>(null);
  const [movePending, startMove] = useTransition();
  const [bulkPending, startBulk] = useTransition();
  const [flipPending, startFlip] = useTransition();
  const [gmailAttachPending, startGmailAttach] = useTransition();
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
    dragPreviewHostRef.current?.replaceChildren();
    dragPreviewRef.current = null;
    dragIconRef.current = null;
    setDraggedIds([]);
    setDropTarget(null);
    setBullseyeCategory("calendar");
    setBullseyeOpen(false);
  }

  const persistGmailAttachment = useCallback((
    playId: string,
    attachment: GmailAttachment,
    correlationId: string,
  ) => {
    if (!eligiblePlayIds.has(playId) || gmailAttachPending) return;
    const previousOptimisticPlays = optimisticPlays;
    const diagnostic = {
      correlationId,
      gmailAccountIndex: attachment.accountIndex,
      gmailHost: "mail.google.com",
      gmailPath: `/mail/u/${attachment.accountIndex}/`,
      gmailThreadRef: attachment.threadRef,
      playId,
    };
    console.info("GMAIL_DROP_ON_PLAY", diagnostic);
    console.info("GMAIL_URL_PARSED", diagnostic);
    setOptimisticPlays({
      source: plays,
      value: localPlays.map((play) => play.id === playId
        ? {
            ...play,
            gmailAccountIndex: attachment.accountIndex,
            gmailThreadId: attachment.threadRef,
            sourceMetadata: gmailMetadataWithAttachment(play.sourceMetadata, attachment),
          }
        : play),
    });
    gmailDropTargetRef.current = null;
    gmailCorrelationIdRef.current = null;
    setGmailDropTarget(null);
    startGmailAttach(async () => {
      try {
        const result = await attachGmailToPlay({
          correlationId,
          playId,
          threadContext: attachment.threadContext,
          url: attachment.canonicalUrl,
        });
        if (result.status === "success") {
          setOptimisticPlays({
            source: plays,
            value: localPlays.map((play) => play.id === playId
              ? {
                  ...play,
                  playType: result.values?.playType === "reminder" ? "reminder" : "normal",
                  playerContactId: result.values?.playerContactId ?? play.playerContactId,
                  playerDisplayName: result.values?.playerDisplayName ?? play.playerDisplayName,
                }
              : play),
          });
          setMoveError(null);
          return;
        }
        setOptimisticPlays(previousOptimisticPlays);
        setMoveError(result.message);
      } catch {
        setOptimisticPlays(previousOptimisticPlays);
        setMoveError("Gmail could not be attached to this Play.");
      }
    });
  }, [eligiblePlayIds, gmailAttachPending, localPlays, optimisticPlays, plays]);

  useEffect(() => {
    function acceptExtensionFallback(event: Event) {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
      try {
        const detail = JSON.parse(event.detail) as {
          correlationId?: unknown;
          playId?: unknown;
          threadContext?: unknown;
          url?: unknown;
        };
        if (
          typeof detail.playId !== "string" ||
          typeof detail.url !== "string"
        ) return;
        const parsedAttachment = parseGmailAttachmentUrl(detail.url);
        const attachment = parsedAttachment
          ? { ...parsedAttachment, threadContext: sanitizeGmailThreadContext(detail.threadContext) ?? undefined }
          : null;
        if (!attachment) return;
        persistGmailAttachment(
          detail.playId,
          attachment,
          typeof detail.correlationId === "string" ? detail.correlationId : crypto.randomUUID(),
        );
      } catch {
        // Ignore malformed cross-context extension events.
      }
    }
    window.addEventListener("carnival:gmail-drop-fallback", acceptExtensionFallback);
    return () => window.removeEventListener(
      "carnival:gmail-drop-fallback",
      acceptExtensionFallback,
    );
  }, [persistGmailAttachment]);

  function beginDrag(playId: string, event: DragEvent<HTMLLIElement>) {
    const ids = playIdsForDrag({
      draggedPlayId: playId,
      eligiblePlayIds,
      selectedIds,
      visibleIds,
    });
    if (!dragOriginAllowedRef.current || !ids.length) {
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
    if (ids.length > 1) {
      const count = document.createElement("span");
      count.className = "playDragCount";
      count.textContent = `${ids.length} Plays`;
      preview.append(count);
    }
    const dragIcon = document.createElement("span");
    dragIcon.className = "playDragIcon";
    dragIcon.dataset.dragIcon = "true";
    const dragGlyph = document.createElement("span");
    dragGlyph.className = "playDragIconGlyph";
    dragGlyph.textContent = "✥";
    dragIcon.append(dragGlyph);
    if (ids.length > 1) {
      const count = document.createElement("span");
      count.className = "playDragIconCount";
      count.textContent = String(ids.length);
      dragIcon.append(count);
    }
    const transparentDragImage = document.createElement("canvas");
    transparentDragImage.className = "transparentDragImage";
    transparentDragImage.width = 1;
    transparentDragImage.height = 1;
    dragPreviewRef.current?.remove();
    dragIconRef.current?.remove();
    previewHost.replaceChildren(preview, dragIcon, transparentDragImage);
    dragPreviewRef.current = preview;
    dragIconRef.current = dragIcon;
    dragPointerOffsetRef.current = {
      x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width),
      y: Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height),
    };
    updateDragPreview(event.clientX, event.clientY);
    preview.getBoundingClientRect();
    event.dataTransfer.setDragImage(transparentDragImage, 0, 0);

    setDraggedIds(ids);
    setBullseyeCategory("calendar");
    setBullseyeOpen(false);
    setMoveError(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ids.join(","));
  }

  function updateDragPreview(clientX: number, clientY: number) {
    if (!clientX && !clientY) return;
    const preview = dragPreviewRef.current;
    const dragIcon = dragIconRef.current;
    const grid = playListRef.current;
    if (!preview || !dragIcon || !grid) return;
    const bounds = grid.getBoundingClientRect();
    const insideGrid = clientX >= bounds.left && clientX <= bounds.right &&
      clientY >= bounds.top && clientY <= bounds.bottom;
    preview.dataset.visible = insideGrid ? "true" : "false";
    dragIcon.dataset.visible = insideGrid ? "false" : "true";
    if (insideGrid) {
      preview.style.left = `${clientX - dragPointerOffsetRef.current.x}px`;
      preview.style.top = `${clientY - dragPointerOffsetRef.current.y}px`;
    } else {
      dragIcon.style.left = `${clientX + 14}px`;
      dragIcon.style.top = `${clientY + 14}px`;
    }
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

  function applyBulkChange(change: BulkPlayChange) {
    const playIds = visibleIds.filter((id) => draggedIds.includes(id) && eligiblePlayIds.has(id));
    if (!playIds.length || bulkPending) return;
    const previousOptimisticPlays = optimisticPlays;
    const previousSelection = selectedIds;
    const keepMovedInView = change.kind !== "move" || isCurrentPlacement(change.placement);
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
    clearDragState();
    startBulk(async () => {
      try {
        const result = await bulkUpdatePlays({ change, playIds });
        if (result.status === "success") {
          setMoveError(null);
          console.info("DRAG_ACTION_COMPLETE", { count: playIds.length, kind: change.kind });
          return;
        }
        setOptimisticPlays(previousOptimisticPlays);
        setSelectedIds(previousSelection);
        setMoveError(result.message);
        console.info("DRAG_ACTION_FAILED", { count: playIds.length, kind: change.kind });
      } catch {
        setOptimisticPlays(previousOptimisticPlays);
        setSelectedIds(previousSelection);
        setMoveError("PlayHouse could not change these Plays. The previous values were restored.");
        console.info("DRAG_ACTION_FAILED", { count: playIds.length, kind: change.kind });
      }
    });
  }

  function applyBulkStatus(status: "done" | "trash") {
    const playIds = visibleIds.filter((id) => draggedIds.includes(id) && eligiblePlayIds.has(id));
    if (!playIds.length || bulkPending) return;
    const previousOptimisticPlays = optimisticPlays;
    const previousSelection = selectedIds;
    setOptimisticPlays({
      source: plays,
      value: localPlays.filter((play) => !playIds.includes(play.id)),
    });
    setSelectedIds(new Set());
    clearDragState();
    startBulk(async () => {
      try {
        const result = await bulkSetPlayStatus({ playIds, status });
        if (result.status === "success") {
          setMoveError(null);
          console.info("DRAG_ACTION_COMPLETE", { count: playIds.length, kind: status });
          return;
        }
        setOptimisticPlays(previousOptimisticPlays);
        setSelectedIds(previousSelection);
        setMoveError(result.message);
        console.info("DRAG_ACTION_FAILED", { count: playIds.length, kind: status });
      } catch {
        setOptimisticPlays(previousOptimisticPlays);
        setSelectedIds(previousSelection);
        setMoveError("PlayHouse could not update these Plays. The previous values were restored.");
        console.info("DRAG_ACTION_FAILED", { count: playIds.length, kind: status });
      }
    });
  }

  function applyRankFlip(play: PlayListItem, playType: "normal" | "reminder") {
    if (flipPending) return;
    const previousOptimisticPlays = optimisticPlays;
    let nextPlays = optimisticallyFlipPlayRank(
      localPlays,
      play.id,
      playType,
      true,
    );
    const multiDate = Boolean(searchQuery) || selectedView.kind === "all" ||
      (selectedView.kind === "calendar" && selectedView.key === "week");
    nextPlays = [...nextPlays].sort(
      multiDate ? compareChronologicalPlays : comparePlayRankAndPriority,
    );
    setOptimisticPlays({ source: plays, value: nextPlays });
    setFlippingPlayId(play.id);
    startFlip(async () => {
      try {
        const result = await flipPlayRank({ playId: play.id, playType });
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
    applyRankFlip(play, visualType === "reminder" ? "normal" : "reminder");
  }

  function persistMove(placement: PlayPlacement, beforePlayId: string | null) {
    if (!draggedIds.length || movePending) return;
    const playIds = visibleIds.filter((id) => draggedIds.includes(id));
    const kind = placement.kind === "calendar" ? "DATE" : "BASKET";
    const destination = placement.kind === "calendar"
      ? placement.scheduledDate
      : placement.basketId;
    console.info(`DROP_${kind}`, { count: playIds.length, destination });
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
    clearDragState();
    startMove(async () => {
      try {
        const result = await repositionPlays({ beforePlayId, placement, playIds });
        if (result.status !== "success") {
          setOptimisticPlays(previousOptimisticPlays);
          setMoveError(result.message);
          console.info("DRAG_ACTION_FAILED", {
            count: playIds.length,
            kind: kind.toLowerCase(),
          });
          return;
        }
        setSelectedIds(new Set());
        setSelectionAnchor(null);
        setMoveError(null);
        console.info("DRAG_ACTION_COMPLETE", { count: playIds.length, kind: kind.toLowerCase() });
      } catch {
        setOptimisticPlays(previousOptimisticPlays);
        setMoveError("PlayHouse could not move these Plays. The previous order was restored.");
        console.info("DRAG_ACTION_FAILED", { count: playIds.length, kind: kind.toLowerCase() });
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

  function bullseyeCategoryProps(category: BullseyeCategory) {
    return {
      onDragEnter: () => {
        setBullseyeCategory(category);
        console.info("BULLSEYE_CATEGORY_SELECTED", {
          category,
          count: draggedIds.length,
        });
      },
      onDragOver: (event: DragEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
    };
  }

  function applyBullseyeDrop(
    event: DragEvent<HTMLButtonElement>,
    action: { change: BulkPlayChange; kind: "change" } |
      { kind: "status"; status: "done" | "trash" },
    eventName: "DROP_DONE" | "DROP_PUSH" | "DROP_RANK" | "DROP_TRASH",
    value: string,
  ) {
    event.preventDefault();
    console.info(eventName, { count: draggedIds.length, value });
    if (action.kind === "change") applyBulkChange(action.change);
    else applyBulkStatus(action.status);
  }

  return (
    <main className="workspace">
      <BrowserTimeZone />
      <div aria-hidden="true" className="playDragPreviewHost" ref={dragPreviewHostRef} />
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
            <div className="bullseyeSwitcher">
              <button
                aria-expanded={bullseyeOpen}
                aria-label="Bullseye drag actions"
                className="bullseyeControl"
                onDragEnter={() => {
                  if (!draggedIds.length) return;
                  setBullseyeOpen(true);
                  console.info("BULLSEYE_OPENED", { count: draggedIds.length });
                }}
                onDragOver={(event) => {
                  if (!draggedIds.length) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                type="button"
              >
                <span aria-hidden="true" className="bullseyeIcon">◎</span>
                Bullseye
              </button>
              {bullseyeOpen && draggedIds.length ? (
                <div
                  aria-label="Bullseye categories"
                  aria-orientation="horizontal"
                  className="bullseyeCategories"
                  role="menu"
                >
                  {(["calendar", "baskets", "rank", "push"] as const).map((category) => (
                    <button
                      data-active={bullseyeCategory === category || undefined}
                      key={category}
                      role="menuitem"
                      type="button"
                      {...bullseyeCategoryProps(category)}
                    >
                      {category[0].toUpperCase() + category.slice(1)}
                    </button>
                  ))}
                  <button
                    data-drop-target={dropTarget === "status:done" || undefined}
                    onDragOver={(event) => {
                      if (!draggedIds.length) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropTarget("status:done");
                    }}
                    onDrop={(event) => applyBullseyeDrop(
                      event,
                      { kind: "status", status: "done" },
                      "DROP_DONE",
                      "done",
                    )}
                    role="menuitem"
                    type="button"
                  >Done</button>
                  <button
                    data-drop-target={dropTarget === "status:trash" || undefined}
                    onDragOver={(event) => {
                      if (!draggedIds.length) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropTarget("status:trash");
                    }}
                    onDrop={(event) => applyBullseyeDrop(
                      event,
                      { kind: "status", status: "trash" },
                      "DROP_TRASH",
                      "trash",
                    )}
                    role="menuitem"
                    type="button"
                  >Trash</button>
                </div>
              ) : null}
            </div>
            {bullseyeCategory === "calendar" ? (
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
            ) : bullseyeCategory === "baskets" ? (
              <div
                aria-label="Basket destinations"
                className="navItems bullseyeOptions"
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
            ) : bullseyeCategory === "rank" ? (
              <div aria-label="Rank destinations" className="navItems bullseyeOptions">
                <button
                  className="destinationLink"
                  data-drop-target={dropTarget === "rank:normal" || undefined}
                  onDragOver={(event) => {
                    if (!draggedIds.length) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTarget("rank:normal");
                  }}
                  onDrop={(event) => applyBullseyeDrop(
                    event,
                    { change: { kind: "rank", playType: "normal" }, kind: "change" },
                    "DROP_RANK",
                    "headline",
                  )}
                  type="button"
                ><span className="destinationIcon" aria-hidden="true">●</span>Headline</button>
                <button
                  className="destinationLink"
                  data-drop-target={dropTarget === "rank:reminder" || undefined}
                  onDragOver={(event) => {
                    if (!draggedIds.length) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTarget("rank:reminder");
                  }}
                  onDrop={(event) => applyBullseyeDrop(
                    event,
                    { change: { kind: "rank", playType: "reminder" }, kind: "change" },
                    "DROP_RANK",
                    "reminder",
                  )}
                  type="button"
                ><span className="destinationIcon" aria-hidden="true">●</span>Reminder</button>
              </div>
            ) : (
              <div aria-label="Push destinations" className="navItems bullseyeOptions">
                {([
                  ["Everyday", "everyday"],
                  ["Weekday", "weekdays"],
                  ["Weekend", "weekends"],
                ] as const).map(([label, pushRule]) => (
                  <button
                    className="destinationLink"
                    data-drop-target={dropTarget === `push:${pushRule}` || undefined}
                    key={pushRule}
                    onDragOver={(event) => {
                      if (!draggedIds.length) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropTarget(`push:${pushRule}`);
                    }}
                    onDrop={(event) => applyBullseyeDrop(
                      event,
                      { change: { kind: "push", pushRule }, kind: "change" },
                      "DROP_PUSH",
                      pushRule,
                    )}
                    type="button"
                  ><span className="destinationIcon" aria-hidden="true">•</span>{label}</button>
                ))}
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
                  {gridSort ? (
                    <button
                      aria-label="Return to natural order"
                      className="playGridNaturalOrderButton"
                      onClick={() => setGridSort(null)}
                      title="Return to natural order"
                      type="button"
                    >
                      <FlipRankIcon />
                    </button>
                  ) : (
                    <span aria-label="Flip rank" role="columnheader" title="Flip rank">
                      <FlipRankIcon />
                    </span>
                  )}
                </div>
              </div>
              <ol
                aria-busy={movePending || bulkPending}
                className="playList"
                aria-label={`Open Plays in ${selectedView.label}`}
                ref={playListRef}
              >
                {visiblePlays.map((play) => {
                  const playVisual = playVisualForPlay(play);
                  const isPlaceContext = play.contextType === "place";
                  return (
                <li
                  className={`playRow ${playVisual.className}`}
                  data-dragging={draggedIds.includes(play.id) || undefined}
                  data-drop-target={dropTarget === `play:${play.id}` || undefined}
                  data-gmail-drop-target={gmailDropTarget === play.id || undefined}
                  data-selected={selectedIds.has(play.id) || undefined}
                  data-testid="play-row"
                  data-play-row-id={play.id}
                  key={play.id}
                  draggable={!isPlaceContext && !searchQuery && eligiblePlayIds.has(play.id)}
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
                  onDragEnd={clearDragState}
                  onDrag={(event) => updateDragPreview(event.clientX, event.clientY)}
                  onDragLeave={(event) => {
                    if (
                      gmailDropTargetRef.current === play.id &&
                      (!(event.relatedTarget instanceof Node) ||
                        !event.currentTarget.contains(event.relatedTarget))
                    ) {
                      gmailDropTargetRef.current = null;
                      gmailCorrelationIdRef.current = null;
                      setGmailDropTarget(null);
                    }
                  }}
                  onDragStart={(event) => beginDrag(play.id, event)}
                  onPointerDownCapture={rememberDragOrigin}
                  style={{
                    "--play-rank-background": playVisual.backgroundColor,
                    "--play-rank-foreground": playVisual.foregroundColor,
                  } as CSSProperties}
                  onDragOver={(event) => {
                    if (
                      !draggedIds.length &&
                      !isPlaceContext &&
                      eligiblePlayIds.has(play.id) &&
                      mayContainGmailDrag(event.dataTransfer)
                    ) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "link";
                      if (gmailDropTargetRef.current !== play.id) {
                        const correlationId = gmailCorrelationIdFromDragData(event.dataTransfer);
                        gmailCorrelationIdRef.current = correlationId;
                        gmailDropTargetRef.current = play.id;
                        setGmailDropTarget(play.id);
                        console.info("GMAIL_DRAG_ENTER_PH", { correlationId, playId: play.id });
                        console.info("GMAIL_DRAG_OVER_PLAY", { correlationId, playId: play.id });
                      }
                      return;
                    }
                    if (
                      isPlaceContext ||
                      !reorderPlacement ||
                      !draggedIds.length ||
                      draggedIds.includes(play.id)
                    ) {
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTarget(`play:${play.id}`);
                  }}
                  onDrop={(event) => {
                    if (!draggedIds.length && eligiblePlayIds.has(play.id)) {
                      const gmailCandidate = mayContainGmailDrag(event.dataTransfer);
                      const attachment = gmailAttachmentFromDragData(event.dataTransfer);
                      if (attachment) {
                        event.preventDefault();
                        const correlationId = gmailCorrelationIdFromDragData(event.dataTransfer) ??
                          gmailCorrelationIdRef.current ??
                          crypto.randomUUID();
                        if (!gmailCorrelationIdRef.current) {
                          console.info("GMAIL_DRAG_ENTER_PH", { correlationId, playId: play.id });
                        }
                        persistGmailAttachment(
                          play.id,
                          attachment,
                          correlationId,
                        );
                        return;
                      }
                      if (gmailCandidate) {
                        event.preventDefault();
                        console.info("GMAIL_DRAG_PAYLOAD_MISSING", { playId: play.id });
                      }
                      gmailDropTargetRef.current = null;
                      gmailCorrelationIdRef.current = null;
                      setGmailDropTarget(null);
                      return;
                    }
                    gmailDropTargetRef.current = null;
                    gmailCorrelationIdRef.current = null;
                    setGmailDropTarget(null);
                    if (isPlaceContext || !reorderPlacement || draggedIds.includes(play.id)) return;
                    event.preventDefault();
                    persistMove(reorderPlacement, play.id);
                  }}
                >
                  <div className="playRowLine">
                    <div className="playIdentityCell">
                      <button
                        aria-label={isPlaceContext
                          ? `Place context ${play.title}`
                          : `${selectedIds.has(play.id) ? "Deselect" : "Select"} ${playVisual.label} Play ${play.title}`}
                        aria-pressed={selectedIds.has(play.id)}
                        className="playSelectControl"
                        disabled={movePending || bulkPending || !eligiblePlayIds.has(play.id)}
                        onClick={(event) => toggleSelection(play.id, event)}
                        title={isPlaceContext ? "Whole-day Place context" : "Select Play"}
                        type="button"
                      />
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
                      {isPlaceContext ? (
                        <span className="playContextTitle" data-testid="place-title" title={play.title}>
                          {play.title}
                        </span>
                      ) : (
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
                      )}
                    </div>
                    <span className="playDataCell" title={play.branch ?? undefined}>
                      {displayBranch(play.branch) ?? "—"}
                    </span>
                    {isPlaceContext ? (
                      <div aria-label="Place context" className="statusActionArea">
                        <div aria-hidden="true" className="statusActions">
                          {Array.from({ length: 5 }, (_, index) => (
                            <span className="rowActionPlaceholder" key={index} />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <PlayStatusActions
                        flipPending={flipPending && flippingPlayId === play.id}
                        onFlipRank={playVisual.visualType === "appointment"
                          ? undefined
                          : () => requestRankFlip(play)}
                        play={play}
                      />
                    )}
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
