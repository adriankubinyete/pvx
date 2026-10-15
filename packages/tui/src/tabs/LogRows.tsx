import { useTheme } from "../theme-context.tsx";
import { clean } from "../palette/search.ts";
import { detailLines, LEVEL_WORD, sourceLabel, timeText, type LogLine } from "./logs-view.ts";

/** Cells before the message of a detail line: under the message of the row (time, gaps and cursor). */
const DETAIL_INDENT_W = 12;
const CURSOR_W = 2;

interface Props {
  line: LogLine;
  /** The cursor is on this line of the active tab. */
  on: boolean;
  /** The cursor stays here while the tab has no focus. */
  current: boolean;
  lit: boolean;
  /** The line is open: its facts show under it. */
  opened: boolean;
  /** The `↳ fase … · tarefa …` line of a job's line, shown while it is the current one. */
  hint?: string;
  sourceWidth: number;
  onOver: (id: string) => void;
  onOut: (id: string) => void;
  onPick: (line: LogLine) => void;
}

/** One entry: `13:00:41  alfa  aviso  text`. Only a warning or an error says its level; the current line shows the lines that continue it and, for a job, where it is. */
export function LogRowView({ line, on, current, lit, opened, hint, sourceWidth, onOver, onOut, onPick }: Props) {
  const { c, g } = useTheme();
  const { entry } = line;
  const word = LEVEL_WORD[entry.level];
  const wordColor = entry.level === "error" ? c.error : c.warn;
  const marker = on ? <span fg={c.accent}>{`${g.cursor} `}</span> : <span fg={c.dim}>{lit || current ? `${g.query} ` : " ".repeat(CURSOR_W)}</span>;
  return (
    <box id={`log:${line.id}`} flexDirection="column" flexShrink={0}>
      <box flexShrink={0} backgroundColor={on ? c.selected : lit ? c.panel : undefined} onMouseOver={() => onOver(line.id)} onMouseOut={() => onOut(line.id)} onMouseDown={() => onPick(line)}>
        <text wrapMode="none">
          {marker}
          <span fg={c.text}>{`${timeText(entry.at)}  `}</span>
          <span fg={c.accent}>{`${sourceLabel(entry.source).padEnd(sourceWidth)}  `}</span>
          {word ? <span fg={wordColor}>{`${word}  `}</span> : null}
          <span fg={c.text}>{clean(entry.message)}</span>
        </text>
      </box>
      {current ? entry.detail.map((text, index) => <text key={index} wrapMode="none" flexShrink={0} fg={c.dim}>{`${" ".repeat(DETAIL_INDENT_W)}${clean(text)}`}</text>) : null}
      {current && hint ? <text wrapMode="none" flexShrink={0} fg={c.dim}>{`${" ".repeat(DETAIL_INDENT_W)}${hint}`}</text> : null}
      {opened ? detailLines(entry).map((text, index) => <text key={index} wrapMode="none" flexShrink={0} fg={c.dim}>{`${" ".repeat(DETAIL_INDENT_W)}${text}`}</text>) : null}
    </box>
  );
}
