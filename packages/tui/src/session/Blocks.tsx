import { memo, useState } from "react";
import type { OutLine } from "@pvx/sdk";
import { shortcuts } from "../keymap.ts";
import { useTheme } from "../theme-context.tsx";
import type { Block } from "./store.ts";

const kinds = { success: "ok", warning: "warn", error: "error", info: "info" } as const;
/** Error-block actions, from the one shortcut table. */
const errorActions = shortcuts.filter((s) => s.scope === "session" && s.keys.startsWith("alt+"));
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

/**
 * One scrollback block: command line, status and duration, output indented 3 cells. `actions`: error shortcuts.
 * `tick` only matters while running (the spinner frame). Memoized, and hover is local state, so hovering repaints one block.
 */
export const BlockView = memo(function BlockView({ b, actions, tick, onPick }: { b: Block; actions: boolean; tick: number; onPick: (b: Block) => void }) {
  const { c, g } = useTheme();
  const [hover, setHover] = useState(false);
  const frames = [...g.spinner];
  const st = { running: [frames[tick % frames.length]!, c.info], ok: [g.ok, c.accent], warn: [g.warn, c.warn], error: [g.error, c.error] }[b.status]!;
  return (
    <box id={`b${b.id}`} flexDirection="column" flexShrink={0} backgroundColor={hover ? c.selected : c.panel} paddingX={1}
      onMouseOver={() => setHover(true)} onMouseOut={() => setHover(false)} onMouseDown={() => onPick(b)}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text>
          <span fg={c.accent}>{`${g.prompt} `}</span>
          <span fg={c.text}><b>{b.line}</b></span>
        </text>
        <text>
          <span fg={st[1]}>{`${st[0]} `}</span>
          <span fg={c.dim}>{b.ms === undefined ? "" : dur(b.ms)}</span>
        </text>
      </box>
      <box flexDirection="column" paddingLeft={3} flexShrink={0}>
        {b.lines.map((l, i) => <Line key={i} l={l} />)}
        {actions ? (
          <text fg={c.dim}>
            {errorActions.map((s, i) => (
              <span key={s.keys}><span fg={c.accent}><b>{s.keys}</b></span>{` ${s.label}${i < errorActions.length - 1 ? "   " : ""}`}</span>
            ))}
          </text>
        ) : null}
      </box>
    </box>
  );
});
