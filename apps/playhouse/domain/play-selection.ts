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
