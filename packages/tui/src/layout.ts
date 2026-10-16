import { useTerminalDimensions } from "@opentui/react";

export const MIN_COLS = 80;
export const MIN_ROWS = 24;
export const WIDE_COLS = 100;
/** The widest a section of a page gets: past it the extra width stays blank at the right, so nothing sits far from its content. */
export const CONTENT_MAX_W = 110;

/** `width` cells, no more than the readable content width. */
export function capContent(width: number): number {
  return Math.min(width, CONTENT_MAX_W);
}

/** `narrow`: below 100 columns, where the home side panel becomes a single column. */
export function useLayout() {
  const { width: cols, height: rows } = useTerminalDimensions();
  return { cols, rows, narrow: cols < WIDE_COLS };
}
