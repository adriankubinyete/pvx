import { useReducer, useEffect, useRef } from "react";
import type { CoreLine } from "@pvx/core";
import { followProps } from "../follow.ts";
import { hintText, matchKey } from "../keymap.ts";
import { useKeys } from "../keys.tsx";
import { BlockView } from "../session/Blocks.tsx";
import type { Block, SessionApi } from "../session/store.ts";
import { useTheme } from "../theme-context.tsx";

const noop = () => {};

/** Last result of a core command, kept for the TUI session (memory only). */
export interface CoreResult {
  at: number;
  exit: number;
  lines: CoreLine[];
}
export type CoreCache = Record<string, CoreResult | "running" | undefined>;

export const hhmm = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const hhmmss = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const LOGS_REFRESH_MS = 5000;

/** Runs `line` into `cache` (no-op while running); `done` fires on start and on finish. */
export function refreshCore(store: SessionApi, cache: CoreCache, line: string, done: () => void) {
  if (cache[line] === "running") return;
  cache[line] = "running";
  done();
  void store.capture(line).then((r) => {
    cache[line] = { at: Date.now(), exit: r.exit, lines: r.lines };
    done(); // no-op if the tab was left meanwhile; the result waits in the cache
  });
}

/**
 * Output of a core command (`conformidade`, `plano`, `logs`). Runs on the first visit; after that only on `r`.
 * Goes through `store.capture`: no block in the Comando scrollback and no history entry.
 * `logs` also refreshes by itself every `refreshMs` while the tab is mounted, and follows the end like the Comando scrollback.
 */
export function CoreTab({ store, line, cache, refreshMs = LOGS_REFRESH_MS }: { store: SessionApi; line: string; cache: CoreCache; refreshMs?: number }) {
  const { c, box, g } = useTheme();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const refresh = () => refreshCore(store, cache, line, bump);
  useEffect(() => {
    if (!cache[line]) refresh();
  }, []);
  useEffect(() => {
    if (line !== "logs") return;
    const t = setInterval(refresh, refreshMs);
    return () => clearInterval(t);
  }, [line, refreshMs]);
  useKeys((k) => {
    if (matchKey(k, "r")) return refresh(), true;
  });
  const r = cache[line];
  // While a refresh runs, the previous result stays on screen: an empty frame would reset the scroll.
  const prev = useRef<CoreResult | undefined>(undefined);
  const done = typeof r === "object" ? (prev.current = r) : prev.current;
  const b: Block | undefined = {
    id: 0, line, moduleId: "core", lines: done?.lines ?? [],
    status: !done ? "running" : done.exit !== 0 ? "error" : done.lines.some((l) => l.kind === "warning") ? "warn" : "ok",
  };
  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" {...box()} title={`${g.query} ${line}`}>
      <text fg={c.dim} flexShrink={0}>{done ? `${line === "logs" ? `atualizado ${hhmmss(done.at)}` : `verificado às ${hhmm(done.at)}`} · ${hintText("tabs", "r")}` : "verificando…"}</text>
      <scrollbox flexGrow={1} minHeight={0} {...(line === "logs" ? followProps : {})} focused>
        <BlockView b={b} focused={false} tick={0} onPick={noop} />
      </scrollbox>
    </box>
  );
}
