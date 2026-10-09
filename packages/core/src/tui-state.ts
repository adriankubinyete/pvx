import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULT_PVX_HOME = "/etc/pvx";

/** Session state the TUI restores on the next launch. Axis values are validated by the TUI. */
export interface TuiState {
  theme: "dark" | "light";
  accent: string;
  symbols: "unicode" | "ascii";
  border: "rounded" | "single" | "none";
  result: "bracket" | "glyph" | "text";
}

export function defaultTuiState(): TuiState {
  return { theme: "dark", accent: "menta", symbols: "unicode", border: "rounded", result: "bracket" };
}

export function tuiStatePath(): string {
  return join(process.env.PVX_HOME ?? DEFAULT_PVX_HOME, "tui-state.json");
}

/** Reads the saved state; a missing or broken file, or an unknown value, yields the default. */
export function loadTuiState(path = tuiStatePath()): TuiState {
  const d = defaultTuiState();
  try {
    if (!existsSync(path)) return d;
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const pick = <K extends keyof TuiState>(k: K, ok: readonly unknown[]): TuiState[K] => (ok.includes(raw?.[k]) ? raw[k] : d[k]);
    return {
      theme: pick("theme", ["dark", "light"]),
      accent: typeof raw?.accent === "string" ? raw.accent : d.accent,
      symbols: pick("symbols", ["unicode", "ascii"]),
      border: pick("border", ["rounded", "single", "none"]),
      result: pick("result", ["bracket", "glyph", "text"]),
    };
  } catch {
    return d;
  }
}

export function saveTuiState(state: TuiState, path = tuiStatePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Debounced writer: `save` coalesces bursts, `flush` writes any pending state now (call on exit). */
export function createTuiStateWriter(path = tuiStatePath(), delayMs = 300) {
  let pending: TuiState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const s = pending;
    pending = null;
    try {
      saveTuiState(s, path);
    } catch {}
  };
  return {
    save(s: TuiState) {
      pending = s;
      timer ??= setTimeout(flush, delayMs);
    },
    flush,
  };
}
