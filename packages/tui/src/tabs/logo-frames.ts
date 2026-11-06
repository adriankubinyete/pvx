import { renderText } from "./logo-font.ts";

/** The product mark, five rows of block characters. */
export const LOGO = renderText("PHONEVOX");

/** Cells of the widest row. */
export const LOGO_W = Math.max(...LOGO.map((row) => [...row].length));
/** Cells kept free on each side of the mark: the cursor stands there after the last letter, so nothing moves. */
export const CURSOR_ROOM_W = 3;
/** Cells the cursor takes: as thick as a stroke of the letters. */
export const CURSOR_W = 2;
/** Cells of the mark with its room: what the box is as wide as. */
export const LOGO_BOX_W = LOGO_W + 2 * CURSOR_ROOM_W;

/** The columns each letter takes, `[first, last]`: a column that is blank in every row ends a letter. */
export function letterSpans(rows: readonly string[] = LOGO): [number, number][] {
  const width = Math.max(...rows.map((row) => [...row].length));
  const spans: [number, number][] = [];
  let start: number | undefined;
  for (let col = 0; col <= width; col++) {
    const inked = col < width && rows.some((row) => (row[col] ?? " ") !== " ");
    if (inked && start === undefined) start = col;
    if (!inked && start !== undefined) {
      spans.push([start, col - 1]);
      start = undefined;
    }
  }
  return spans;
}

const LETTERS = letterSpans();

/** What the mark shows for a moment: how many letters are written, whether the cursor is lit, and for how long (ms). */
export interface LogoFrame {
  letters: number;
  cursor: boolean;
  ms: number;
}

const BLINK_MS = 500;
const BLINKS = 3;
const ERASE_MS = 80;
const WAIT_BLINKS = 2;
const TYPE_MS = 140;

/** A cursor that blinks `times` times (lit, then dark) with `letters` written. */
const blinks = (letters: number, times: number): LogoFrame[] => Array.from({ length: times * 2 }, (_, i) => ({ letters, cursor: i % 2 === 0, ms: BLINK_MS }));

/**
 * One turn of the typewriter, starting with the mark written and its cursor blinking: the blinks, the letters erased from the end, a wait with
 * the cursor blinking on the empty line, the letters typed again. Then it starts over.
 */
export function logoFrames(count = LETTERS.length): LogoFrame[] {
  const erase = Array.from({ length: count }, (_, i) => ({ letters: count - 1 - i, cursor: true, ms: ERASE_MS }));
  const type = Array.from({ length: count }, (_, i) => ({ letters: i + 1, cursor: true, ms: TYPE_MS }));
  return [...blinks(count, BLINKS), ...erase, ...blinks(0, WAIT_BLINKS), ...type];
}

/** The five rows of the mark for a frame, each `LOGO_BOX_W` cells wide: the letters written, and the cursor right after the last one when lit. */
export function logoRows(frame: Pick<LogoFrame, "letters" | "cursor">): string[] {
  const end = frame.letters === 0 ? 0 : LETTERS[frame.letters - 1]![1] + 1; // first column after the last written letter
  const cursorAt = CURSOR_ROOM_W + end + (frame.letters === 0 ? 0 : 1); // one cell of space after the letter
  return LOGO.map((row) => {
    const cells = [...(" ".repeat(CURSOR_ROOM_W) + [...row].slice(0, end).join("").padEnd(LOGO_W) + " ".repeat(CURSOR_ROOM_W))];
    if (frame.cursor) for (let i = 0; i < CURSOR_W; i++) cells[cursorAt + i] = "█";
    return cells.join("");
  });
}
