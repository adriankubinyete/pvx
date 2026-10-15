import { Button } from "../sdk-ui/button.tsx";
import { toneColor } from "../sdk-ui/tones.ts";
import { useTheme } from "../theme-context.tsx";
import { truncate, type HomeAction, type HomeRow } from "./home-rows.ts";

/** Cells of the marker column of a row (`»`, the hover `›` or blank) and the blank that follows the result marker. */
const CURSOR_W = 2;
/** Cells between the text of a row and its button. */
const BUTTON_GAP_W = 2;
/** The two brackets and the two spaces of `[ label ]`. */
const BUTTON_CHROME_W = 4;
/** Cells of the buttons line before the first button: under the text of the rows. */
const ACTIONS_INDENT_W = 4;
const ACTIONS_GAP_W = 3;

interface RowViewProps {
  row: HomeRow;
  /** The cursor is on this row of the active list. */
  on: boolean;
  /** The mouse is over it. */
  lit: boolean;
  /** Cells the row may use. */
  width: number;
  idPrefix: string;
  onOver: (row: HomeRow) => void;
  onOut: (row: HomeRow) => void;
  onPick: (row: HomeRow) => void;
}

function useMarker(row: HomeRow): { text: string; color: string } | undefined {
  const { c, result } = useTheme();
  if (row.level) {
    const { marker, color } = result(row.level);
    return { text: `${marker} `, color };
  }
  if (row.glyph) return { text: `${row.glyph[0]} `, color: toneColor(c, row.glyph[1]) };
  return undefined;
}

/** One row of a section: the marker, the text cut to fit, a dim note, and the button at the end when it has one. */
export function HomeRowView({ row, on, lit, width, idPrefix, onOver, onOut, onPick }: RowViewProps) {
  const { c, g } = useTheme();
  const marker = useMarker(row);
  const buttonCells = row.button ? BUTTON_GAP_W + [...row.button].length + BUTTON_CHROME_W : 0;
  const note = row.note ? ` ${row.note}` : "";
  const room = width - CURSOR_W - [...(marker?.text ?? "")].length - buttonCells - [...note].length;
  const cursor = on ? <span fg={c.accent}>{`${g.cursor} `}</span> : <span fg={c.dim}>{lit ? `${g.query} ` : " ".repeat(CURSOR_W)}</span>;
  return (
    <box id={`${idPrefix}:${row.id}`} flexShrink={0} flexDirection="row" justifyContent="space-between" backgroundColor={on ? c.selected : lit ? c.panel : undefined}
      onMouseOver={() => onOver(row)} onMouseOut={() => onOut(row)}>
      <box flexShrink={1} onMouseDown={() => onPick(row)}>
        <text wrapMode="none">
          {cursor}
          {marker ? <span fg={marker.color}>{marker.text}</span> : null}
          <span fg={row.action ? c.accent : row.dim ? c.dim : c.text}>{truncate(row.text, room)}</span>
          <span fg={c.dim}>{note}</span>
        </text>
      </box>
      {row.button ? <Button label={row.button} focused={false} onPress={() => onPick(row)} /> : null}
    </box>
  );
}

interface ActionsProps {
  buttons: { action: HomeAction; label: string }[];
  /** The button the keyboard is on, when the cursor is on the actions row. */
  current?: HomeAction;
  onPress: (action: HomeAction) => void;
}

/** The section's own buttons side by side, after a blank row (UI.md: one blank row between content and buttons). */
export function ActionsLine({ buttons, current, onPress }: ActionsProps) {
  return (
    <>
      <text wrapMode="none" flexShrink={0}> </text>
      <box flexDirection="row" columnGap={ACTIONS_GAP_W} paddingLeft={ACTIONS_INDENT_W} flexShrink={0}>
        {buttons.map(({ action, label }) => (
          <Button key={action} label={label} primary={action === "plan"} focused={current === action} onPress={() => onPress(action)} />
        ))}
      </box>
    </>
  );
}
