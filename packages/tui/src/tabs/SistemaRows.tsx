import type { ReactNode } from "react";
import { buttonLook, LookText } from "../sdk-ui/button.tsx";
import { useOver } from "../hover.ts";
import { useTheme } from "../theme-context.tsx";
import type { Options } from "./sistema.ts";

/** Cells of the label column of a setting row. */
export const SETTING_LABEL_W = 14;
/** Cells of the marker column (`»`, the hover `›` or blank). */
const CURSOR_W = 2;

interface SettingRowProps {
  id: string;
  label: string;
  /** The cursor is on this row of the active page. */
  on: boolean;
  /** The row the cursor stays on while the page has no focus: a muted `›`. */
  current: boolean;
  /** The mouse is over it. */
  lit: boolean;
  onOver: (id: string) => void;
  onOut: (id: string) => void;
  onPress: (id: string) => void;
  children: ReactNode;
}

/** One setting: the cursor, the dim label and the controls. Hover tints it (panel background and a dim ›); the selection keeps its `»` only with the page active. */
export function SettingRow({ id, label, on, current, lit, onOver, onOut, onPress, children }: SettingRowProps) {
  const { c, g } = useTheme();
  const cursor = on ? <span fg={c.accent}>{`${g.cursor} `}</span> : <span fg={c.dim}>{lit || current ? `${g.query} ` : " ".repeat(CURSOR_W)}</span>;
  return (
    <box id={`sistema:${id}`} flexShrink={0} flexDirection="row" backgroundColor={on ? c.selected : lit ? c.panel : undefined}
      onMouseOver={() => onOver(id)} onMouseOut={() => onOut(id)} onMouseDown={() => onPress(id)}>
      <text wrapMode="none" flexShrink={0}>
        {cursor}
        <span fg={on || lit || current ? c.text : c.dim}>{label.padEnd(SETTING_LABEL_W)}</span>
      </text>
      {children}
    </box>
  );
}

/** Cells between two choices when there is room, and when there is not. */
const CHOICE_GAP_W = 2;
const CHOICE_GAP_TIGHT_W = 1;
/** The two brackets and the two spaces the chosen one gets: `[ Escuro ]`. */
const CHOSEN_CHROME_W = 4;

/** The gap that lets every choice of a row fit in `room` cells: the roomy one when it does, else the tight one. */
export function choiceGap(options: Options, room: number): number {
  const labels = options.reduce((sum, [, label]) => sum + [...label].length, 0);
  const roomy = labels + CHOSEN_CHROME_W + CHOICE_GAP_W * (options.length - 1);
  return roomy <= room ? CHOICE_GAP_W : CHOICE_GAP_TIGHT_W;
}

/** The choices of a row: the chosen one is a button `[ Escuro ]` (filled while the row has the cursor), the others are plain words. A click chooses. */
export function ChoiceCells({ options, value, on, room, onChoose, onHover }: { options: Options; value: string; on: boolean; room: number; onChoose: (value: string) => void; /** The mouse is over an option (or left them all): the page previews it. */ onHover?: (value: string | undefined) => void }) {
  const { c } = useTheme();
  return (
    <box flexDirection="row" flexShrink={0} columnGap={choiceGap(options, room)}>
      {options.map(([option, label]) => {
        const look = buttonLook(label, { primary: true, lit: on }, c);
        return (
          <box key={option} flexShrink={0} onMouseDown={() => onChoose(option)} onMouseOver={() => onHover?.(option)} onMouseOut={() => onHover?.(undefined)}>
            {option === value ? <LookText look={look} /> : <text wrapMode="none" fg={c.text}>{label}</text>}
          </box>
        );
      })}
    </box>
  );
}

/** Cells between two swatches. */
const SWATCH_GAP_W = 2;
/** The value the accent row stands for when the accent follows the theme. */
const FOLLOW_THEME = "tema";

interface SwatchProps {
  options: Options;
  /** The accent in use. */
  value: string;
  /** The swatch the keyboard is on (the row has the cursor); it may differ from `value` until enter chooses it. */
  cursor?: string;
  /** The color of each preset swatch; `tema` has none of its own and is drawn dim. */
  colors: Record<string, string>;
  onChoose: (value: string) => void;
  /** The mouse is over a swatch (or left them all): the page previews it. */
  onHover?: (value: string | undefined) => void;
}

/**
 * The accent picker: one `●` per preset, two spaces apart. The chosen one is `(●) roxo` with its name in bold; `tema` (the accent follows
 * the theme) is a dim `◌`. A swatch the cursor or the mouse is on, and that is not the chosen one, is underlined on the `panel` fill.
 */
export function SwatchCells({ options, value, cursor, colors, onChoose, onHover }: SwatchProps) {
  const { c, g } = useTheme();
  const over = useOver();
  return (
    <box flexDirection="row" flexShrink={0} columnGap={SWATCH_GAP_W}>
      {options.map(([option, label]) => {
        const chosen = option === value;
        const glyph = option === FOLLOW_THEME ? g.auto : g.active;
        const color = option === FOLLOW_THEME ? c.dim : colors[option];
        const lit = !chosen && (cursor === option || over.over === option);
        const dot = <span fg={color}>{glyph}</span>;
        return (
          <box key={option} flexShrink={0} onMouseOver={() => (over.enter(option), onHover?.(option))} onMouseOut={() => (over.leave(option), onHover?.(undefined))} onMouseDown={() => onChoose(option)}>
            <text wrapMode="none" bg={lit ? c.panel : undefined}>
              {chosen ? <><span fg={c.text}>(</span>{dot}<span fg={c.text}>{") "}</span><span fg={c.text}><b>{label}</b></span></> : lit ? <u>{dot}</u> : dot}
            </text>
          </box>
        );
      })}
    </box>
  );
}
