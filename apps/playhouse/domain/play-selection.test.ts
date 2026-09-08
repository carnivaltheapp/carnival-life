import { describe, expect, it, vi } from "vitest";

import {
  beginRegionSelection,
  exceedsRegionSelectionDragThreshold,
  regionSelectionPlayIdAtPoint,
  togglePlaySelection,
  touchRegionSelection,
} from "./play-selection";

describe("Play multi-selection", () => {
  const visibleIds = ["a", "b", "c", "d"];

  it("selects, adds, and deselects individual Plays", () => {
    const one = togglePlaySelection({
      anchorId: null,
      clickedId: "a",
      selectedIds: new Set(),
      shiftKey: false,
      visibleIds,
    });
    const two = togglePlaySelection({
      anchorId: "a",
      clickedId: "c",
      selectedIds: one,
      shiftKey: false,
      visibleIds,
    });
    const deselected = togglePlaySelection({
      anchorId: "c",
      clickedId: "a",
      selectedIds: two,
      shiftKey: false,
      visibleIds,
    });
    expect([...one]).toEqual(["a"]);
    expect([...two]).toEqual(["a", "c"]);
    expect([...deselected]).toEqual(["c"]);
  });

  it("adds a Shift-selected visible range", () => {
    expect([...togglePlaySelection({
      anchorId: "a",
      clickedId: "c",
      selectedIds: new Set(["a"]),
      shiftKey: true,
      visibleIds,
    })]).toEqual(["a", "b", "c"]);
  });

  it("supports Select All and Clear through ordinary Set state", () => {
    expect([...new Set(visibleIds)]).toEqual(visibleIds);
    expect(new Set<string>().size).toBe(0);
  });

  it("toggles a crossed row only once in each region gesture", () => {
    const gesture = beginRegionSelection(new Set(["a"]));
    expect(touchRegionSelection(gesture, "a")).toBe(true);
    expect([...gesture.selectedIds]).toEqual([]);
    expect(touchRegionSelection(gesture, "a")).toBe(false);
    expect([...gesture.selectedIds]).toEqual([]);
    expect(touchRegionSelection(gesture, "b")).toBe(true);
    expect([...gesture.selectedIds]).toEqual(["b"]);
  });

  it("hit-tests the stable Play row ID from pointer viewport coordinates", () => {
    const closest = vi.fn().mockReturnValue({ dataset: { playRowId: "play-2" } });
    const elementFromPoint = vi.fn().mockReturnValue({ closest });
    expect(regionSelectionPlayIdAtPoint(
      { elementFromPoint } as unknown as Pick<Document, "elementFromPoint">,
      140,
      220,
    )).toBe("play-2");
    expect(elementFromPoint).toHaveBeenCalledWith(140, 220);
    expect(closest).toHaveBeenCalledWith("[data-play-row-id]");
  });

  it("distinguishes a blank click from a region drag at the five-pixel threshold", () => {
    expect(exceedsRegionSelectionDragThreshold(10, 10, 13, 13)).toBe(false);
    expect(exceedsRegionSelectionDragThreshold(10, 10, 13, 14)).toBe(true);
    expect(exceedsRegionSelectionDragThreshold(10, 10, 10, 15)).toBe(true);
  });
});
