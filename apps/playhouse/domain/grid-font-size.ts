export const GRID_FONT_SIZE_STORAGE_KEY = "playhouse-grid-font-size";
export const DEFAULT_GRID_FONT_SIZE = 12;
export const MIN_GRID_FONT_SIZE = 10;
export const MAX_GRID_FONT_SIZE = 20;

export function parseGridFontSize(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) return DEFAULT_GRID_FONT_SIZE;
  return Math.min(MAX_GRID_FONT_SIZE, Math.max(MIN_GRID_FONT_SIZE, Number(value)));
}

export function stepGridFontSize(current: number, direction: -1 | 1) {
  return Math.min(
    MAX_GRID_FONT_SIZE,
    Math.max(MIN_GRID_FONT_SIZE, Math.round(current) + direction),
  );
}
