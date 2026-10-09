import { useTerminalDimensions } from "@opentui/react";

export const MIN_COLS = 80;
export const MIN_ROWS = 24;
export const WIDE_COLS = 100;

/** `narrow`: below 100 columns, where the home side panel becomes a single column. */
export function useLayout() {
  const { width: cols, height: rows } = useTerminalDimensions();
  return { cols, rows, narrow: cols < WIDE_COLS };
}
