import type { ReactNode } from "react";
import { buttonLook, LookText } from "../sdk-ui/button.tsx";
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
export function ChoiceCells({ options, value, on, room, onChoose }: { options: Options; value: string; on: boolean; room: number; onChoose: (value: string) => void }) {
  const { c } = useTheme();
  return (
    <box flexDirection="row" flexShrink={0} columnGap={choiceGap(options, room)}>
      {options.map(([option, label]) => {
        const look = buttonLook(label, { primary: true, lit: on }, c);
        return (
          <box key={option} flexShrink={0} onMouseDown={() => onChoose(option)}>
            {option === value ? <LookText look={look} /> : <text wrapMode="none" fg={c.text}>{label}</text>}
          </box>
        );
      })}
    </box>
  );
}

/** The swatches of an accent row: two cells of each preset, the chosen one between brackets. `themeAccent` is what `tema` shows. */
export function SwatchCells({ options, value, colors, onChoose }: { options: Options; value: string; colors: Record<string, string>; onChoose: (value: string) => void }) {
  const { c } = useTheme();
  return (
    <box flexDirection="row" flexShrink={0}>
      {options.map(([option]) => {
        const chosen = option === value;
        return (
          <box key={option} flexShrink={0} onMouseDown={() => onChoose(option)}>
            <text wrapMode="none">
              <span fg={c.text}>{chosen ? "[" : " "}</span>
              <span bg={colors[option]}>{"  "}</span>
              <span fg={c.text}>{chosen ? "]" : " "}</span>
            </text>
          </box>
        );
      })}
      <text wrapMode="none" fg={c.dim}>{`  ${options.find(([option]) => option === value)?.[1] ?? ""}`}</text>
    </box>
  );
}
