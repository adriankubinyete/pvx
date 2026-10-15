import { memo } from "react";
import type { OutLine } from "@pvx/sdk";
import { shortcuts } from "../keymap.ts";
import { useOver } from "../hover.ts";
import { clockText } from "../tabs/clock.tsx";
import { useTheme } from "../theme-context.tsx";
import type { Block } from "./store.ts";

const kinds = { success: "ok", warning: "warn", error: "error", info: "info" } as const;
/** Action row of the focused block, from the one shortcut table. */
const allActions = shortcuts.filter((s) => s.scope === "block" && s.hint);
/** Columns of the start time (`13:31:02`) and of the blank that stands in for it on a block with no start. */
const TIME_W = 8;
/** The start time before the command; blank (same width) for a block that has none, so the commands still line up. */
const startTime = (at: number | undefined): string => (at === undefined ? " ".repeat(TIME_W) : clockText(new Date(at), "time"));
const dur = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

function Line({ l }: { l: OutLine }) {
  const { c, result } = useTheme();
  if (l.kind === "plain") return <text fg={c.dim}>{l.text}</text>;
  const r = result(kinds[l.kind]);
  return (
    <text>
      <span fg={r.color}>{r.marker}</span>
      <span fg={c.text}>{` ${l.text}`}</span>
    </text>
  );
}

/** One clickable action of the focused block's footer: hover underlines it, a click runs the same action as its key. */
function Hint({ keys, label, onPick }: { keys: string; label: string; onPick: () => void }) {
  const { c } = useTheme();
  const { over: o, enter, leave } = useOver<"x">();
  const over = o !== undefined;
  return (
    <box flexShrink={0} onMouseOver={() => enter("x")} onMouseOut={() => leave("x")} onMouseDown={(e) => (e.stopPropagation(), onPick())}>
      <text wrapMode="none">
        <span fg={c.accent}><b>{over ? <u>{keys}</u> : keys}</b></span>
        <span fg={over ? c.text : c.dim}>{over ? <u>{` ${label}`}</u> : ` ${label}`}</span>
      </text>
    </box>
  );
}

/**
 * One scrollback block: the start time inline before the command, status and duration at the right, results at the left margin, under the time. `focused`: selected background, `»` and the action row.
 * `tick` only matters while running (the spinner frame). Memoized. Hover tints only the header (`selected` background, dim `›`, underlined command): the focused block tints the whole block and shows the accent `»`, so the two never look alike. `onAct` runs a footer action by its key.
 */
export const BlockView = memo(function BlockView({ b, focused, tick, onPick, onAct }: { b: Block; focused: boolean; tick: number; onPick: (b: Block) => void; onAct?: (b: Block, keys: string) => void }) {
  const { c, g } = useTheme();
  const { over: o, enter, leave } = useOver<"x">();
  const over = o !== undefined && onAct !== undefined; // read-only lists (no `onAct`) never look clickable
  const blockActions = allActions.filter((s) => s.keys !== "x" || (b.status === "running" && b.cancellable));
  const host = b.line.startsWith("!"); // ran on the host shell: the marker says it, so the `!` is not part of the command text
  const commandText = host ? b.line.slice(1) : b.line;
  const frames = [...g.spinner];
  const st = { running: [frames[tick % frames.length]!, c.info], ok: [g.ok, c.ok], warn: [g.warn, c.warn], error: [g.error, c.error] }[b.status]!;
  return (
    <box id={`b${b.id}`} flexDirection="column" flexShrink={0} backgroundColor={focused ? c.selected : undefined} paddingX={1}
      onMouseOver={() => enter("x")} onMouseOut={() => leave("x")} onMouseDown={() => onPick(b)}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0} backgroundColor={over && !focused ? c.selected : undefined}>
        <text>
          <span fg={c.dim}>{`${startTime(b.at)}  `}</span>
          <span fg={focused || !over ? (host ? c.warn : c.accent) : c.dim}>{`${focused ? g.cursor : over ? g.query : host ? g.shell : g.prompt} `}</span>
          <span fg={c.text}><b>{over && !focused ? <u>{commandText}</u> : commandText}</b></span>
        </text>
        <text>
          <span fg={st[1]}>{`${st[0]} `}</span>
          <span fg={c.dim}>{b.ms === undefined ? "" : dur(b.ms)}</span>
        </text>
      </box>
      <box flexDirection="column" flexShrink={0}>
        {b.lines.map((l, i) => <Line key={i} l={l} />)}
        {focused ? (
          <box flexDirection="row" gap={3} flexShrink={0}>
            {blockActions.map((s) => <Hint key={s.keys} keys={s.keys} label={s.label} onPick={() => onAct?.(b, s.keys)} />)}
          </box>
        ) : null}
      </box>
    </box>
  );
});
