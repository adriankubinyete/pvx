import type { ListCellPart, ListColumn } from "@pvx/sdk";

/** Marquee timing; a test may shrink it. */
export const marquee = { pauseMs: 1200, stepMs: 120 };

export const GAP = 2;
const MIN_W = 3;
const len = (s: string) => [...s].length;

export interface Sizing { col: ListColumn; natural: number }

/** The widest a column gets, whatever its content or its `grow`: a longer text is cut with `…`. Extra room stays blank at the right of the table. */
export const COLUMN_MAX_W = 60;

/** Shares of `rest` cells by weight; a column never takes more than its own `limit`, and what it leaves goes to the others. */
function shareGrowing(limits: number[], weights: number[], rest: number): number[] {
  const widths = limits.map(() => MIN_W);
  let open = limits.map((_, i) => i);
  let left = rest - MIN_W * limits.length;
  while (open.length && left > 0) {
    const total = open.reduce((n, i) => n + weights[i]!, 0);
    const capped = open.filter((i) => widths[i]! + Math.floor((left * weights[i]!) / total) >= limits[i]!);
    if (!capped.length) {
      open.forEach((i) => (widths[i] = widths[i]! + Math.floor((left * weights[i]!) / total)));
      break;
    }
    capped.forEach((i) => {
      left -= limits[i]! - widths[i]!;
      widths[i] = limits[i]!;
    });
    open = open.filter((i) => !capped.includes(i));
  }
  return widths;
}

/** Column widths for `avail` cells. Fixed never shrinks; auto (no width, no grow) takes its content and shrinks first; grow takes what is left but never more than its content, and no column passes `COLUMN_MAX_W`. */
export function columnWidths(sizings: Sizing[], avail: number | undefined): number[] {
  const cols = sizings.map(({ col, natural }) => ({ col, natural: Math.min(natural, COLUMN_MAX_W) }));
  if (avail === undefined) return cols.map(({ col, natural }) => col.width ?? natural);
  const budget = Math.max(0, avail - GAP * (cols.length - 1));
  const fixed = cols.reduce((n, { col }) => n + (col.width ?? 0), 0);
  const w = cols.map(({ col, natural }) => col.width ?? (col.grow ? MIN_W : natural));
  const flex = cols.map((s, i) => (s.col.width === undefined ? i : -1)).filter((i) => i >= 0);
  const autos = flex.filter((i) => !cols[i]!.col.grow);
  const grows = flex.filter((i) => cols[i]!.col.grow);
  // Shrink the widest auto column one cell at a time until everything fits.
  const minGrow = grows.length * MIN_W;
  while (fixed + autos.reduce((n, i) => n + w[i]!, 0) + minGrow > budget) {
    const widest = autos.reduce((b, i) => (b < 0 || w[i]! > w[b]! ? i : b), -1);
    if (widest < 0 || w[widest]! <= 1) break;
    w[widest]!--;
  }
  if (grows.length) {
    const rest = Math.max(minGrow, budget - fixed - autos.reduce((n, i) => n + w[i]!, 0));
    const shares = shareGrowing(grows.map((i) => Math.max(MIN_W, cols[i]!.natural)), grows.map((i) => cols[i]!.col.grow!), rest);
    grows.forEach((i, k) => (w[i] = shares[k]!));
  }
  return w;
}

/** Cells hidden past the cell edge (0 when the text fits). */
export const overflow = (text: string, width: number) => Math.max(0, len(text) - width);

/** Marquee offset at `tick`: start, pause, scroll to the end, pause, scroll back. */
export function marqueeOffset(tick: number, over: number, pause: number): number {
  if (over <= 0) return 0;
  const phase = tick % (2 * pause + 2 * over);
  if (phase < pause) return 0;
  if (phase < pause + over) return phase - pause + 1;
  if (phase < 2 * pause + over) return over;
  return over - (phase - (2 * pause + over)) - 1;
}

/** Characters fitted to `width`: padded with `blank`, or cut with `ellipsis`, or (offset > 0) a window of them. */
function fitChars<T>(chars: T[], blank: T, ellipsis: T, width: number, align: "left" | "right", offset: number): T[] {
  if (chars.length <= width) {
    const pad = Array.from({ length: width - chars.length }, () => blank);
    return align === "right" ? [...pad, ...chars] : [...chars, ...pad];
  }
  if (offset > 0) return chars.slice(offset, offset + width);
  return width <= 1 ? [ellipsis].slice(0, width) : [...chars.slice(0, width - 1), ellipsis];
}

/** Text fitted to `width`: padded, or cut with `…`, or (offset > 0) a window of the text. */
export function fit(text: string, width: number, align: "left" | "right" = "left", offset = 0): string {
  return fitChars([...text], " ", "…", width, align, offset).join("");
}

/** `fit` for a cell made of toned parts: the same padding, cut and window, and the pieces that stay keep their tones (merged when neighbors share one). */
export function fitParts(parts: ListCellPart[], width: number, align: "left" | "right" = "left", offset = 0): ListCellPart[] {
  const chars = parts.flatMap((part) => [...part.text].map((char) => ({ char, tone: part.tone })));
  const fitted = fitChars(chars, { char: " ", tone: undefined }, { char: "…", tone: undefined }, width, align, offset);
  const spans: ListCellPart[] = [];
  for (const { char, tone } of fitted) {
    const last = spans.at(-1);
    if (last && last.tone === tone) last.text += char;
    else spans.push({ text: char, tone });
  }
  return spans;
}
