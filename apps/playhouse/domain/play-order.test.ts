import { describe, expect, it } from "vitest";

import { orderUpdatesForInsertion } from "./play-order";

describe("Play order insertion", () => {
  it("updates only the moved Plays when sparse order space is available", () => {
    expect(orderUpdatesForInsertion({
      beforePlayId: "b",
      destination: [
        { id: "a", order: 1000 },
        { id: "b", order: 2000 },
        { id: "c", order: 3000 },
      ],
      movingPlayIds: ["c"],
      step: 1000,
    })).toEqual([{ id: "c", order: 1500 }]);
  });

  it("preserves group order and rebalances only when no gap remains", () => {
    expect(orderUpdatesForInsertion({
      beforePlayId: "b",
      destination: [
        { id: "a", order: 1 },
        { id: "b", order: 2 },
      ],
      movingPlayIds: ["x", "y"],
      step: 1000,
    })).toEqual([
      { id: "a", order: 1000 },
      { id: "x", order: 2000 },
      { id: "y", order: 3000 },
      { id: "b", order: 4000 },
    ]);
  });

  it("preserves the relative order of a moved group", () => {
    expect(orderUpdatesForInsertion({
      beforePlayId: null,
      destination: [],
      movingPlayIds: ["third", "first", "second"],
      step: 1000,
    })).toEqual([
      { id: "third", order: 1000 },
      { id: "first", order: 2000 },
      { id: "second", order: 3000 },
    ]);
  });

  it("keeps inserted orders inside a destination's configured range", () => {
    expect(orderUpdatesForInsertion({
      beforePlayId: "first",
      destination: [{ id: "first", order: 10_100 }],
      lowerBound: 10_000,
      movingPlayIds: ["moved"],
      step: 100,
    })).toEqual([
      { id: "moved", order: 10_050 },
    ]);
  });
});
