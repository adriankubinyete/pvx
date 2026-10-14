import type { ListColumn } from "@pvx/sdk";

/** Marquee timing; a test may shrink it. */
export const marquee = { pauseMs: 1200, stepMs: 120 };

export const GAP = 2;
const MIN_W = 3;
const len = (s: string) => [...s].length;

export interface Sizing { col: ListColumn; natural: number }

/** Column widths for `avail` cells. Fixed never shrinks; auto (no width, no grow) shrinks first; grow splits the rest. */
export function columnWidths(cols: Sizing[], avail: number | undefined): number[] {
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
    const total = grows.reduce((n, i) => n + cols[i]!.col.grow!, 0);
    let left = rest;
    grows.forEach((i, k) => {
      const share = k === grows.length - 1 ? left : Math.max(MIN_W, Math.floor((rest * cols[i]!.col.grow!) / total));
      w[i] = share;
      left -= share;
    });
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

/** Text fitted to `width`: padded, or cut with `…`, or (offset > 0) a window of the text. */
export function fit(text: string, width: number, align: "left" | "right" = "left", offset = 0): string {
  const chars = [...text];
  if (chars.length <= width) { const pad = " ".repeat(width - chars.length); return align === "right" ? pad + text : text + pad; }
  if (offset > 0) return chars.slice(offset, offset + width).join("");
  return width <= 1 ? "…".slice(0, width) : `${chars.slice(0, width - 1).join("")}…`;
}
