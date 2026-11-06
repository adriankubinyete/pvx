import { renderText } from "./logo-font.ts";

/** What the sign says. */
export const SIGN_TEXT = "PHONEVOX GROUP TECHNOLOGY";
const SIGN = renderText(SIGN_TEXT);
/** Cells of the widest row of the text. */
export const SIGN_W = Math.max(...SIGN.map((row) => [...row].length));

/** Blank cells between one copy of the text and the next, as on a bus sign. */
export const MARQUEE_GAP_W = 14;
/** Cells from the start of one copy to the start of the next: the text scrolls this far and begins again. */
export const MARQUEE_PERIOD = SIGN_W + MARQUEE_GAP_W;
/** Milliseconds per cell of scroll. */
export const MARQUEE_STEP_MS = 70;

/** One row of the strip: the row of the text, then the gap, repeated across `width` cells from `offset` cells into the strip. */
function strip(row: string, offset: number, width: number): string {
  const unit = row.padEnd(SIGN_W) + " ".repeat(MARQUEE_GAP_W);
  const copies = Math.ceil((width + MARQUEE_PERIOD) / MARQUEE_PERIOD) + 1;
  const start = ((offset % MARQUEE_PERIOD) + MARQUEE_PERIOD) % MARQUEE_PERIOD;
  return unit.repeat(copies).slice(start, start + width);
}

/** The five rows of the sign `width` cells wide, scrolled `offset` cells to the left. */
export function marqueeRows(offset: number, width: number): string[] {
  return SIGN.map((row) => strip(row, offset, width));
}
