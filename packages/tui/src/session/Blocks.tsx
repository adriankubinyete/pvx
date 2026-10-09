import type { OutLine } from "@pvx/sdk";
import { useTheme } from "../theme-context.tsx";
import type { Block } from "./store.ts";

const kinds = { success: "ok", warning: "warn", error: "error", info: "info" } as const;
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

/** One scrollback block: command line, status and duration, output indented 3 cells. `actions`: error shortcuts. */
export function BlockView({ b, actions }: { b: Block; actions: boolean }) {
  const { c, g } = useTheme();
  const st = { running: [g.spinner, c.info], ok: [g.ok, c.accent], warn: [g.warn, c.warn], error: [g.error, c.error] }[b.status]!;
  return (
    <box id={`b${b.id}`} flexDirection="column" flexShrink={0} backgroundColor={c.panel} paddingX={1}>
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
            {[["r", "repetir"], ["l", "log do módulo"], ["c", "copiar erro"]].map(([k, v], i) => (
              <span key={k}><span fg={c.accent}><b>{k}</b></span>{` ${v}${i < 2 ? "   " : ""}`}</span>
            ))}
          </text>
        ) : null}
      </box>
    </box>
  );
}
