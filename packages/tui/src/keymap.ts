import type { KeyEvent } from "@opentui/core";
import { paletteShortcuts } from "./palette/shortcuts.ts";

export type Scope = "global" | "menu" | "home" | "tabs" | "session" | "block" | "palette" | "form" | "result" | "log" | "search" | "modal" | `page:${string}`;

export interface Shortcut {
  /** Display text, also the spec for `matchKey`: `ctrl+k`, `esc`, `?`, `L`, `enter`. */
  keys: string;
  label: string;
  scope: Scope;
  /** Shown in the footer line (while its scope is active). Rows without it still show in the `?` help for their scope. */
  footer?: boolean;
  /** Shown in the action row under the focused block. */
  hint?: boolean;
}

/** The ONE shortcut table: the footer line and the `?` help both render from it. Add rows here. */
const base: readonly Shortcut[] = [
  { keys: "esc", label: "voltar", scope: "global", footer: true },
  { keys: "?", label: "ajuda", scope: "global", footer: true },
  { keys: "ctrl+c", label: "sair", scope: "global" },
  { keys: "↑↓", label: "move", scope: "menu", footer: true },
  { keys: "enter", label: "abre", scope: "menu", footer: true },
  { keys: "/", label: "comando", scope: "menu" },
  { keys: "ctrl+k", label: "palette", scope: "menu", footer: true },
  { keys: "tab", label: "abas", scope: "menu", footer: true },
  { keys: "esc", label: "sobe um nível", scope: "menu" },
  { keys: "↑↓", label: "move", scope: "home", footer: true },
  { keys: "←→", label: "painel", scope: "home", footer: true },
  { keys: "enter", label: "usa", scope: "home", footer: true },
  { keys: "r", label: "atualiza", scope: "home", footer: true },
  { keys: "ctrl+k", label: "palette", scope: "home" },
  { keys: "tab", label: "abas", scope: "home" },
  { keys: "←→", label: "troca aba", scope: "tabs", footer: true },
  { keys: "↓/enter", label: "entra na aba", scope: "tabs", footer: true },
  { keys: "tab", label: "próxima aba", scope: "tabs", footer: true },
  { keys: "shift+tab", label: "aba anterior", scope: "tabs" },
  { keys: "ctrl+k", label: "palette", scope: "tabs", footer: true },
  { keys: "r", label: "atualiza", scope: "tabs" }, // core tabs only (conformidade, plano, logs); shown inline there, not in the footer
  { keys: "←→", label: "cursor", scope: "session" },
  { keys: "↑", label: "histórico", scope: "session", footer: true },
  { keys: "ctrl+r", label: "busca", scope: "session", footer: true },
  { keys: "!!", label: "repete", scope: "session", footer: true },
  { keys: "#", label: "páginas", scope: "session", footer: true },
  { keys: "ctrl+k", label: "palette", scope: "session", footer: true },
  { keys: "ctrl+l", label: "limpa", scope: "session", footer: true },
  { keys: "tab", label: "completa", scope: "session" },
  { keys: "esc", label: "foca os blocos", scope: "session" }, // empty input; with no blocks it focuses the tab bar (shift+tab always does)
  { keys: "enter", label: "roda", scope: "session" },
  { keys: "enter", label: "escolhe", scope: "search", footer: true },
  { keys: "esc", label: "sai", scope: "search" },
  { keys: "enter", label: "envia", scope: "modal" },
  { keys: "esc", label: "cancela", scope: "modal" },
  { keys: "tab", label: "campo", scope: "form", footer: true },
  { keys: "←→", label: "cursor", scope: "form", footer: true },
  { keys: "space", label: "marca", scope: "form", footer: true },
  { keys: "enter", label: "roda", scope: "form", footer: true },
  { keys: "ctrl+k", label: "palette", scope: "form", footer: true },
  { keys: "enter", label: "voltar", scope: "result", footer: true },
  { keys: "ctrl+k", label: "palette", scope: "log", footer: true },
  { keys: "↑↓", label: "move blocos", scope: "block", footer: true },
  { keys: "esc", label: "abas", scope: "block", footer: true },
  { keys: "r", label: "repetir", scope: "block", footer: true, hint: true },
  { keys: "l", label: "log", scope: "block", footer: true, hint: true },
  { keys: "c", label: "copiar", scope: "block", footer: true, hint: true },
];

/** Base rows plus the palette's own, one row per keys + scope (the first one wins). */
export const shortcuts: readonly Shortcut[] = [...new Map([...base, ...paletteShortcuts].map((s) => [`${s.scope}:${s.keys}`, s])).values()];

/** Rows a module's page adds to its own scope (`page:<key>`): the table stays the one source for footer and help. */
const pageRows = new Map<Scope, Shortcut[]>();
/** Rows of `useKey`, added while the calling component is mounted. */
const dynRows = new Map<Scope, Set<Shortcut>>();
const listeners = new Set<() => void>();
let rev = 0;
const touch = () => (rev++, listeners.forEach((f) => f()));
/** Changes when a page row is added or removed: the footer and `?` re-render on it. */
export const rowsRev = () => rev;
export const subscribeRows = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
/** The page's static rows. Called while rendering, before the footer renders: no notification (a setState there is an error). */
export const setPageRows = (scope: Scope, rows: Shortcut[]) => void pageRows.set(scope, rows);
/** Adds one row; returns the remover. */
export function addPageRow(scope: Scope, row: Shortcut): () => void {
  const set = dynRows.get(scope) ?? dynRows.set(scope, new Set()).get(scope)!;
  set.add(row);
  touch();
  return () => (set.delete(row), touch());
}
const rowsOf = (scope: Scope) => [...shortcuts, ...(pageRows.get(scope) ?? []), ...(dynRows.get(scope) ?? [])];

/** Footer entries for the active scope, global ones last. */
export const footerFor = (scope: Scope): Shortcut[] =>
  [...rowsOf(scope).filter((s) => s.footer && s.scope === scope && scope !== "global"), ...shortcuts.filter((s) => s.footer && s.scope === "global")];

/** Help rows: all rows of the scope (footer or not), then the global ones. */
export const helpFor = (scope: Scope): Shortcut[] =>
  [...rowsOf(scope).filter((s) => s.scope === scope && scope !== "global"), ...shortcuts.filter((s) => s.scope === "global")];

/** Inline hint text from table rows: `hintText("session", "tab", "enter")` -> `tab completa · enter roda`. */
export const hintText = (scope: Scope, ...keys: string[]) =>
  keys.map((k) => { const s = shortcuts.find((r) => r.scope === scope && r.keys === k)!; return `${s.keys} ${s.label}`; }).join(" · ");

const NAMES: Record<string, string> = { esc: "escape", enter: "return" };

/**
 * True if the key event matches `spec` (`[ctrl+|shift+]name`).
 * Shift pitfall: `key.name` is lowercase even with Shift, only `key.sequence` carries `L`.
 * So a single character (`l`, `L`, `?`, `space`) matches on `sequence`, never with ctrl.
 */
export function matchKey(key: KeyEvent, spec: string): boolean {
  if (spec === "ctrl+j" && key.name === "linefeed") return true; // plain terminals: ctrl+j is a raw \n
  const parts = spec === "+" ? ["+"] : spec.split("+");
  const name = parts.pop()!;
  const mods = new Set(parts);
  if (!!key.ctrl !== mods.has("ctrl") || key.meta) return false; // no alt/meta combos: macOS terminals do not send them
  if (!mods.size) {
    if (name === "space") return key.sequence === " ";
    if ([...name].length === 1) return key.sequence === name;
  }
  const want = NAMES[name] ?? name;
  return !!key.shift === mods.has("shift") && (key.name === want || (want === "return" && key.name === "enter"));
}
