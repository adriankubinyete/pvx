import type { Glyphs } from "./theme.ts";

/**
 * A graph of `values` (0..100, oldest first) as `rows` text rows, top row first, `cells` wide. The history is stretched to the width.
 * Braille: 2 values per cell and 4 dot levels per row; otherwise one block character per cell, 8 levels per row. A value is never below level 1 (a baseline).
 */
export function graph(values: readonly number[], cells: number, rows: number, g: Pick<Glyphs, "braille" | "blocks">): string[] {
  const braille = Boolean(g.braille);
  const cols = braille ? cells * 2 : cells;
  const per = braille ? 4 : 8;
  const max = per * rows;
  const level = (k: number) => {
    const v = values.length ? values[Math.min(values.length - 1, Math.floor((k * values.length) / cols))]! : 0;
    return Math.max(1, Math.min(max, Math.round((v / 100) * max)));
  };
  const lv = Array.from({ length: cols }, (_, k) => level(k));
  const LEFT = [0x00, 0x40, 0x44, 0x46, 0x47];
  const RIGHT = [0x00, 0x80, 0xa0, 0xb0, 0xb8];
  const out: string[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    const n = (k: number) => Math.max(0, Math.min(per, lv[k]! - per * r));
    let s = "";
    for (let i = 0; i < cells; i++) {
      if (braille) {
        const bits = LEFT[n(2 * i)]! + RIGHT[n(2 * i + 1)]!;
        s += bits ? String.fromCharCode(0x2800 + bits) : " ";
      } else s += n(i) ? g.blocks[n(i) - 1]! : " ";
    }
    out.push(s);
  }
  return out;
}
