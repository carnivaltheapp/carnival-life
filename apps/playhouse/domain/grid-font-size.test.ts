import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRID_FONT_SIZE,
  MAX_GRID_FONT_SIZE,
  MIN_GRID_FONT_SIZE,
  parseGridFontSize,
  stepGridFontSize,
} from "./grid-font-size";

describe("Play grid font size preference", () => {
  it("uses the current 12px grid size by default", () => {
    expect(DEFAULT_GRID_FONT_SIZE).toBe(12);
    expect(parseGridFontSize(null)).toBe(12);
  });

  it("falls back safely for invalid stored values", () => {
    expect(parseGridFontSize("invalid")).toBe(DEFAULT_GRID_FONT_SIZE);
    expect(parseGridFontSize("12.5")).toBe(DEFAULT_GRID_FONT_SIZE);
    expect(parseGridFontSize("")).toBe(DEFAULT_GRID_FONT_SIZE);
  });

  it("clamps stored and stepped values to the 10px–20px range", () => {
    expect(parseGridFontSize("2")).toBe(MIN_GRID_FONT_SIZE);
    expect(parseGridFontSize("99")).toBe(MAX_GRID_FONT_SIZE);
    expect(stepGridFontSize(MIN_GRID_FONT_SIZE, -1)).toBe(MIN_GRID_FONT_SIZE);
    expect(stepGridFontSize(MAX_GRID_FONT_SIZE, 1)).toBe(MAX_GRID_FONT_SIZE);
  });

  it("increments and decrements exactly one pixel", () => {
    expect(stepGridFontSize(12, 1)).toBe(13);
    expect(stepGridFontSize(12, -1)).toBe(11);
  });
});
