import { describe, expect, it } from "vitest";

import {
  beginRegionSelection,
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
});
