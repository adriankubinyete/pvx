import { memo } from "react";
import type { OutLine } from "@pvx/sdk";
import { shortcuts } from "../keymap.ts";
import { useTheme } from "../theme-context.tsx";
import type { Block } from "./store.ts";

const kinds = { success: "ok", warning: "warn", error: "error", info: "info" } as const;
/** Action row of the focused block, from the one shortcut table. */
const allActions = shortcuts.filter((s) => s.scope === "block" && s.hint);
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
 * One scrollback block: command line, status and duration, output indented 3 cells. `focused`: selected background, `»` and the action row.
 * `tick` only matters while running (the spinner frame). Memoized. Only focus tints the background: no hover, so a resting mouse never looks like focus.
 */
export const BlockView = memo(function BlockView({ b, focused, tick, onPick }: { b: Block; focused: boolean; tick: number; onPick: (b: Block) => void }) {
  const { c, g } = useTheme();
  const blockActions = allActions.filter((s) => s.keys !== "x" || (b.status === "running" && b.cancellable));
  const host = b.line.startsWith("!"); // ran on the host shell
  const frames = [...g.spinner];
  const st = { running: [frames[tick % frames.length]!, c.info], ok: [g.ok, c.accent], warn: [g.warn, c.warn], error: [g.error, c.error] }[b.status]!;
  return (
    <box id={`b${b.id}`} flexDirection="column" flexShrink={0} backgroundColor={focused ? c.selected : c.panel} paddingX={1}
      onMouseDown={() => onPick(b)}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text>
          <span fg={host ? c.warn : c.accent}>{`${focused ? g.cursor : host ? g.shell : g.prompt} `}</span>
          <span fg={c.text}><b>{b.line}</b></span>
        </text>
        <text>
          <span fg={st[1]}>{`${st[0]} `}</span>
          <span fg={c.dim}>{b.ms === undefined ? "" : dur(b.ms)}</span>
        </text>
      </box>
      <box flexDirection="column" paddingLeft={3} flexShrink={0}>
        {b.lines.map((l, i) => <Line key={i} l={l} />)}
        {focused ? (
          <text fg={c.dim}>
            {blockActions.map((s, i) => (
              <span key={s.keys}><span fg={c.accent}><b>{s.keys}</b></span>{` ${s.label}${i < blockActions.length - 1 ? "   " : ""}`}</span>
            ))}
          </text>
        ) : null}
      </box>
    </box>
  );
});
