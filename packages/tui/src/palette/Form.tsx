import type { ArgSpec } from "@pvx/sdk";
import { useTheme } from "../theme-context.tsx";
import { LineText } from "../LineText.tsx";
import { helpOf, labelOf } from "../sdk-ui/labels.ts";
import { clean } from "./search.ts";
import { ARG_ROWS, argWindow, cutText, DETAIL_ROWS, statusText, type BuiltLine, type FormValues } from "./form.ts";

export interface FormProps {
  specs: ArgSpec[];
  values: FormValues;
  /** Index of the field being edited; -1 when the form is not focused. */
  focus: number;
  /** Cursor of the focused text field (code points; clamped to the text). */
  cursor?: number;
  line: BuiltLine;
  /** Last run of this command, if known. */
  last?: string;
  /** Cells the detail may use. */
  width: number;
}

/** Cells of the label column (the required mark included) and of the value cell. */
const LABEL_W = 18;
const FIELD_W = 24;
const REQUIRED_MARK = "*";
/** The cursor column, the space after the label and the two spaces before the hint. */
const MARK_W = 2;
const LABEL_GAP_W = 1;
const HINT_GAP_W = 2;
const FLAG_ON = "[x]";
const FLAG_OFF = "[ ]";

interface FieldRowProps { spec: ArgSpec; value: string | boolean | undefined; focused: boolean; cursor: number; width: number }

/** One argument: its label with the red `*` when required, the value and the terse hint. Same look as the standard form. */
function FieldRow({ spec, value, focused, cursor, width }: FieldRowProps) {
  const { c, g } = useTheme();
  const text = clean(String(value ?? ""));
  const label = cutText(labelOf(spec), LABEL_W - REQUIRED_MARK.length);
  const labelPad = " ".repeat(LABEL_W - REQUIRED_MARK.length - [...label].length + LABEL_GAP_W);
  const hintW = Math.max(0, width - MARK_W - LABEL_W - LABEL_GAP_W - FIELD_W - HINT_GAP_W);
  return (
    <text wrapMode="none" flexShrink={0}>
      <span fg={focused ? c.accent : c.dim}>{focused ? g.cursor : " "} </span>
      <span fg={c.text}>{label}</span>
      <span fg={c.error}>{spec.required ? REQUIRED_MARK : " "}</span>
      <span>{labelPad}</span>
      {spec.kind === "flag"
        ? <span fg={c.accent}>{(value === true ? FLAG_ON : FLAG_OFF).padEnd(FIELD_W)}</span>
        : <LineText line={{ text, cursor: Math.min(cursor, [...text].length) }} focused={focused} width={FIELD_W} mask={spec.secret} fg={c.accent} pad />}
      <span fg={c.dim}>{" ".repeat(HINT_GAP_W) + cutText(helpOf(spec.help), hintW)}</span>
    </text>
  );
}

/**
 * The detail under the palette list: always `DETAIL_ROWS` rows, so the dialog never changes size.
 * `ARG_ROWS` rows for arguments (a window that follows the focus), then the command line and one status row.
 * Display only: the palette owns the keys. Secrets are masked and never reach the CLI line.
 */
export function Form({ specs, values, focus, cursor = Infinity, line, last, width }: FormProps) {
  const { c } = useTheme();
  const { start, hidden } = argWindow(specs.length, focus, ARG_ROWS);
  const shown = specs.slice(start, start + ARG_ROWS);
  const blanks = Array.from({ length: ARG_ROWS - shown.length }, (_, i) => i);
  const status = statusText({ hidden, secrets: Object.keys(line.secrets), last: last ? clean(last) : undefined });
  return (
    <box flexDirection="column" flexShrink={0} height={DETAIL_ROWS}>
      {shown.map((spec, i) => <FieldRow key={spec.name} spec={spec} value={values[spec.name]} focused={start + i === focus} cursor={cursor} width={width} />)}
      {blanks.map((i) => <text key={`blank:${i}`}>{" "}</text>)}
      <text wrapMode="none" fg={c.accent} flexShrink={0}>{cutText(`$ pvx ${clean(line.display)}`, width)}</text>
      <text wrapMode="none" fg={c.dim} flexShrink={0}>{cutText(status, width) || " "}</text>
    </box>
  );
}
