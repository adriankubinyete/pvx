import { Button } from "../sdk-ui/button.tsx";
import { toneColor } from "../sdk-ui/tones.ts";
import { useTheme } from "../theme-context.tsx";
import { truncate, type HomeRow } from "./home-rows.ts";

/** Cells of the marker column of a row (`»`, the hover `›` or blank) and the blank that follows the result marker. */
const CURSOR_W = 2;
/** Cells between the text of a row and its button. */
const BUTTON_GAP_W = 2;
/** The two brackets and the two spaces of `[ label ]`. */
const BUTTON_CHROME_W = 4;

/** Where the columns of a section's rows end: the text (with its marker and note) and the button after it. */
export interface RowColumns {
  /** Cells of the left part of every row: the cursor, the marker, the text and the note. */
  leftW: number;
  /** Cells of the whole row, and of its highlight. */
  rowW: number;
}

interface RowViewProps {
  row: HomeRow;
  /** The cursor is on this row of the active list. */
  on: boolean;
  /** The mouse is over it. */
  lit: boolean;
  columns: RowColumns;
  idPrefix: string;
  onOver: (row: HomeRow) => void;
  onOut: (row: HomeRow) => void;
  onPick: (row: HomeRow) => void;
}

type Theme = Pick<ReturnType<typeof useTheme>, "c" | "result">;

function rowMarker(row: HomeRow, theme: Theme): { text: string; color: string } | undefined {
  if (row.level) {
    const { marker, color } = theme.result(row.level);
    return { text: `${marker} `, color };
  }
  if (row.glyph) return { text: `${row.glyph[0]} `, color: toneColor(theme.c, row.glyph[1]) };
  return undefined;
}

const cellsOf = (text: string): number => [...text].length;
const noteOf = (row: HomeRow): string => (row.note ? ` ${row.note}` : "");
const buttonCells = (row: HomeRow): number => (row.button ? cellsOf(row.button) + BUTTON_CHROME_W : 0);

/** Cells the left part of a row wants: the cursor, the marker, the whole text and the note. */
function leftCells(row: HomeRow, theme: Theme): number {
  return CURSOR_W + cellsOf(rowMarker(row, theme)?.text ?? "") + cellsOf(row.text) + cellsOf(noteOf(row));
}

/**
 * The columns of a section's rows in `width` cells. The button column starts right after the widest text, not at the edge of the section: a button far from its row goes unseen.
 * A text too long for the room is cut by the row.
 */
export function rowColumns(rows: readonly HomeRow[], width: number, theme: Theme): RowColumns {
  const buttonW = Math.max(0, ...rows.map(buttonCells));
  const gap = buttonW ? BUTTON_GAP_W : 0;
  const widest = Math.max(0, ...rows.map((row) => leftCells(row, theme)));
  const leftW = Math.min(widest, Math.max(CURSOR_W, width - buttonW - gap));
  return { leftW, rowW: leftW + gap + buttonW };
}

/** One row of a section: the marker, the text cut to fit, a dim note, and the button after the text column when it has one. */
export function HomeRowView({ row, on, lit, columns, idPrefix, onOver, onOut, onPick }: RowViewProps) {
  const { c, g, result } = useTheme();
  const marker = rowMarker(row, { c, result });
  const note = noteOf(row);
  const room = columns.leftW - CURSOR_W - cellsOf(marker?.text ?? "") - cellsOf(note);
  const cursor = on ? <span fg={c.accent}>{`${g.cursor} `}</span> : <span fg={c.dim}>{lit ? `${g.query} ` : " ".repeat(CURSOR_W)}</span>;
  return (
    <box id={`${idPrefix}:${row.id}`} flexShrink={0} flexDirection="row" width={columns.rowW} backgroundColor={on ? c.selected : lit ? c.panel : undefined}
      onMouseOver={() => onOver(row)} onMouseOut={() => onOut(row)}>
      <box width={columns.leftW} flexShrink={0} onMouseDown={() => onPick(row)}>
        <text wrapMode="none">
          {cursor}
          {marker ? <span fg={marker.color}>{marker.text}</span> : null}
          <span fg={row.action ? c.accent : row.dim ? c.dim : c.text}>{truncate(row.text, room)}</span>
          <span fg={c.dim}>{note}</span>
        </text>
      </box>
      {row.button ? <box marginLeft={BUTTON_GAP_W} flexShrink={0}><Button label={row.button} focused={false} onPress={() => onPick(row)} /></box> : null}
    </box>
  );
}
