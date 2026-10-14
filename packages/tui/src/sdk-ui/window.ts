/**
 * First row of a window of `size` rows over `count` rows that keeps `selectedIndex` in view. It starts from where the window was
 * (`start`) and moves as little as it must, so the rows do not jump while the selection walks inside the window.
 * A selection that is not on a row (`-1`) leaves the window where it was.
 */
export function windowStart(count: number, selectedIndex: number, size: number, start: number): number {
  const lastStart = Math.max(0, count - size);
  const kept = Math.min(Math.max(0, start), lastStart);
  if (selectedIndex < 0) return kept;
  if (selectedIndex < kept) return selectedIndex;
  if (selectedIndex >= kept + size) return Math.min(selectedIndex - size + 1, lastStart);
  return kept;
}
