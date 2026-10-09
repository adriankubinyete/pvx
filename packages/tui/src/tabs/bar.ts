/**
 * Which tabs `[from, to)` the bar shows in `avail` columns. `‹` and `›` take one column each, only when tabs are hidden on that side.
 * `start` is where the bar was: it scrolls only as far as needed to keep the active tab in view.
 */
export function fitBar(widths: number[], active: number, start: number, avail: number): { from: number; to: number } {
  const n = widths.length;
  const span = (from: number) => {
    let w = from > 0 ? 1 : 0;
    let to = from;
    while (to < n && w + widths[to]! + (to + 1 < n ? 1 : 0) <= avail) w += widths[to++]!;
    return Math.max(to, Math.min(from + 1, n));
  };
  let from = Math.max(0, Math.min(start, active));
  while (from < active && span(from) <= active) from++;
  return { from, to: span(from) };
}
