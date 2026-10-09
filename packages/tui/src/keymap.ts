import type { KeyEvent } from "@opentui/core";
import { paletteShortcuts } from "./palette/shortcuts.ts";

export type Scope = "global" | "session" | "palette";

export interface Shortcut {
  /** Display text, also the spec for `matchKey`: `ctrl+k`, `esc`, `?`, `L`, `enter`. */
  keys: string;
  label: string;
  scope: Scope;
  /** Shown in the footer line (while its scope is active). Always listed in the `?` help. */
  footer?: boolean;
}

/** The ONE shortcut table: the footer line and the `?` help both render from it. Add rows here. */
const base: readonly Shortcut[] = [
  { keys: "esc", label: "voltar", scope: "global", footer: true },
  { keys: "?", label: "ajuda", scope: "global", footer: true },
  { keys: "ctrl+c", label: "sair", scope: "global" },
  { keys: "↑", label: "histórico", scope: "session", footer: true },
  { keys: "ctrl+r", label: "busca", scope: "session", footer: true },
  { keys: "!!", label: "repete", scope: "session", footer: true },
  { keys: "#", label: "páginas", scope: "session", footer: true },
  { keys: "ctrl+k", label: "palette", scope: "session", footer: true },
  { keys: "ctrl+l", label: "limpa", scope: "session", footer: true },
  { keys: "tab", label: "completa", scope: "session" },
  { keys: "enter", label: "roda", scope: "session" },
];

/** Base rows plus the palette's own, one row per keys + scope (the first one wins). */
export const shortcuts: readonly Shortcut[] = [...new Map([...base, ...paletteShortcuts].map((s) => [`${s.scope}:${s.keys}`, s])).values()];

/** Footer entries for the active scope, global ones last. */
export const footerFor = (scope: Scope): Shortcut[] =>
  [...shortcuts.filter((s) => s.footer && s.scope === scope && scope !== "global"), ...shortcuts.filter((s) => s.footer && s.scope === "global")];

const NAMES: Record<string, string> = { esc: "escape", enter: "return" };

/**
 * True if the key event matches `spec` (`[ctrl+|shift+|meta+]name`).
 * Shift pitfall: `key.name` is lowercase even with Shift, only `key.sequence` carries `L`.
 * So a single character (`l`, `L`, `?`, `space`) matches on `sequence`, never with ctrl/meta.
 */
export function matchKey(key: KeyEvent, spec: string): boolean {
  if (spec === "ctrl+j" && key.name === "linefeed") return true; // plain terminals: ctrl+j is a raw \n
  const parts = spec === "+" ? ["+"] : spec.split("+");
  const name = parts.pop()!;
  const mods = new Set(parts);
  if (!!key.ctrl !== mods.has("ctrl") || !!key.meta !== mods.has("meta")) return false;
  if (!mods.size) {
    if (name === "space") return key.sequence === " ";
    if ([...name].length === 1) return key.sequence === name;
  }
  const want = NAMES[name] ?? name;
  return !!key.shift === mods.has("shift") && (key.name === want || (want === "return" && key.name === "enter"));
}
