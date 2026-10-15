/** Columns of the card grid: 3 from 120 terminal columns, 2 from 80, else 1. */
export const gridCols = (cols: number): number => (cols >= 120 ? 3 : cols >= 80 ? 2 : 1);
/** Total card height: border, name, what it delivers, a gap, the chips. */
export const CARD_H = 6;
export const CARD_GAP = 1;
/** Columns the page frame padding and the scrollbar take from the terminal width. */
const GRID_CHROME = 3;

/** Columns a module page takes on each side of its content (the padding of the page frame): a grid inside a page has that much less room. */
export const PAGE_INSET = 2;

/** The width of one card of the grid at `cols` terminal columns; `inset` is what the screen around the grid takes besides the tab frame. */
export function cardWidth(cols: number, inset = 0): number {
  const count = gridCols(cols);
  return Math.floor((cols - GRID_CHROME - inset - (count - 1) * CARD_GAP) / count);
}
