import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createTuiStateWriter, loadTuiState, type TuiState } from "@pvx/core";
import { useRenderer } from "@opentui/react";
import { applyAccent, glyphs, resultMarker, tokensFor, type Glyphs, type ResultKind, type Tokens } from "./theme.ts";

export interface ThemeApi {
  /** Color tokens with the chosen accent applied. */
  c: Tokens;
  /** Glyphs for the chosen symbol set. */
  g: Glyphs;
  axes: TuiState;
  /** Changes axes; persisted with debounce. */
  set(patch: Partial<TuiState>): void;
  /** Spread on a `<box>` for a panel border in the chosen style (`none` draws no border). */
  box(color?: string): { border: boolean; borderStyle: "rounded" | "single"; borderColor: string };
  /** Marker and color of a result line in the chosen format. */
  result(kind: ResultKind): { marker: string; color: string };
  /** Writes pending state now. */
  flush(): void;
}

const Ctx = createContext<ThemeApi | null>(null);

export function useTheme(): ThemeApi {
  const t = useContext(Ctx);
  if (!t) throw new Error("useTheme fora do ThemeProvider");
  return t;
}

/** `statePath` defaults to `$PVX_HOME/tui-state.json`. Flushes on unmount. */
export function ThemeProvider({ statePath, children }: { statePath?: string; children: ReactNode }) {
  const writer = useMemo(() => createTuiStateWriter(statePath), [statePath]);
  const [axes, setAxes] = useState(() => loadTuiState(statePath));
  const latest = useRef(axes);
  latest.current = axes;
  useEffect(() => writer.flush, [writer]);

  const set = useCallback((patch: Partial<TuiState>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setAxes(next);
    writer.save(next);
  }, [writer]);

  const renderer = useRenderer();
  const api = useMemo<ThemeApi>(() => {
    const c = applyAccent(axes.theme, tokensFor(axes.theme, axes.custom), axes.accent);
    const g = glyphs[axes.symbols];
    const level = { ok: c.ok, warn: c.warn, error: c.error, info: c.info };
    return {
      c, g, axes, set, flush: writer.flush,
      box: (color = c.border) => ({ border: axes.border !== "none", borderStyle: axes.border === "single" ? "single" : "rounded", borderColor: color }),
      result: (kind) => ({ marker: resultMarker(kind, axes.result, g), color: level[kind] }),
    };
  }, [axes, set, writer]);

  // Nothing repaints on its own: the terminal background and a redraw follow the palette.
  useEffect(() => {
    renderer.setBackgroundColor(api.c.bg);
    renderer.requestRender();
  }, [renderer, api.c]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
