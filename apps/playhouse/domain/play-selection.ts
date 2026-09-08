export function togglePlaySelection({
  anchorId,
  clickedId,
  selectedIds,
  shiftKey,
  visibleIds,
}: {
  anchorId: string | null;
  clickedId: string;
  selectedIds: ReadonlySet<string>;
  shiftKey: boolean;
  visibleIds: string[];
}) {
  const next = new Set(selectedIds);
  if (shiftKey && anchorId) {
    const anchorIndex = visibleIds.indexOf(anchorId);
    const clickedIndex = visibleIds.indexOf(clickedId);
    if (anchorIndex >= 0 && clickedIndex >= 0) {
      const [start, end] = [anchorIndex, clickedIndex].sort((left, right) => left - right);
      visibleIds.slice(start, end + 1).forEach((id) => next.add(id));
      return next;
    }
  }
  if (next.has(clickedId)) next.delete(clickedId);
  else next.add(clickedId);
  return next;
}

export type RegionSelectionGesture = {
  selectedIds: Set<string>;
  touchedIds: Set<string>;
};

export function beginRegionSelection(selectedIds: ReadonlySet<string>): RegionSelectionGesture {
  return { selectedIds: new Set(selectedIds), touchedIds: new Set() };
}

export function touchRegionSelection(gesture: RegionSelectionGesture, playId: string) {
  if (gesture.touchedIds.has(playId)) return false;
  gesture.touchedIds.add(playId);
  if (gesture.selectedIds.has(playId)) gesture.selectedIds.delete(playId);
  else gesture.selectedIds.add(playId);
  return true;
}

export function regionSelectionPlayIdAtPoint(
  documentRoot: Pick<Document, "elementFromPoint">,
  clientX: number,
  clientY: number,
) {
  return documentRoot.elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>("[data-play-row-id]")
    ?.dataset.playRowId ?? null;
}

export const REGION_SELECTION_DRAG_THRESHOLD = 5;

export function exceedsRegionSelectionDragThreshold(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
) {
  return Math.hypot(clientX - startX, clientY - startY) >= REGION_SELECTION_DRAG_THRESHOLD;
}
