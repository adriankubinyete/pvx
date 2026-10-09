import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULT_PVX_HOME = "/etc/pvx";

/** Session state the TUI restores on the next launch. */
export interface TuiState {
  theme: "dark" | "light";
}

export function defaultTuiState(): TuiState {
  return { theme: "dark" };
}

export function tuiStatePath(): string {
  return join(process.env.PVX_HOME ?? DEFAULT_PVX_HOME, "tui-state.json");
}

/** Reads the saved state; a missing or broken file yields the defaults. */
export function loadTuiState(path = tuiStatePath()): TuiState {
  const d = defaultTuiState();
  try {
    if (!existsSync(path)) return d;
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return { theme: raw?.theme === "light" ? "light" : d.theme };
  } catch {
    return d;
  }
}

export function saveTuiState(state: TuiState, path = tuiStatePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
